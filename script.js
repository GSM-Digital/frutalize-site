const form = document.querySelector("#interest-form");
const phoneInput = document.querySelector("#phone");
const formStatus = document.querySelector("#form-status");
const submitButton = form.querySelector('button[type="submit"]');

const fields = {
  name: {
    input: document.querySelector("#name"),
    error: document.querySelector("#name-error"),
    message: "Digite seu nome.",
  },
  phone: {
    input: phoneInput,
    error: document.querySelector("#phone-error"),
    message: "Digite um telefone válido.",
  },
  email: {
    input: document.querySelector("#email"),
    error: document.querySelector("#email-error"),
    message: "Digite um e-mail válido.",
  },
};

function formatPhone(value) {
  const digits = value.replace(/\D/g, "").slice(0, 11);

  if (digits.length <= 2) return digits ? `(${digits}` : "";
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function setFieldState(field, isValid) {
  field.input.setAttribute("aria-invalid", String(!isValid));
  field.input.setAttribute("aria-describedby", `${field.input.id}-error`);
  field.error.textContent = isValid ? "" : field.message;
}

phoneInput.addEventListener("input", () => {
  phoneInput.value = formatPhone(phoneInput.value);
});

Object.values(fields).forEach((field) => {
  field.input.addEventListener("input", () => {
    if (field.input.id === "phone") {
      setFieldState(field, field.input.value.replace(/\D/g, "").length >= 10);
      return;
    }

    setFieldState(field, field.input.validity.valid && field.input.value.trim() !== "");
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  formStatus.textContent = "";
  formStatus.classList.remove("is-error");

  const validations = {
    name: fields.name.input.value.trim().length >= 2,
    phone: fields.phone.input.value.replace(/\D/g, "").length >= 10,
    email: fields.email.input.validity.valid && fields.email.input.value.trim() !== "",
  };

  Object.entries(validations).forEach(([key, isValid]) => {
    setFieldState(fields[key], isValid);
  });

  const firstInvalid = Object.entries(validations).find(([, isValid]) => !isValid);

  if (firstInvalid) {
    fields[firstInvalid[0]].input.focus();
    return;
  }

  const originalButtonText = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = "Enviando...";

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch("/api/leads.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fields.name.input.value.trim(),
        phone: fields.phone.input.value.trim(),
        email: fields.email.input.value.trim(),
      }),
      signal: controller.signal,
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || "Não foi possível concluir seu cadastro.");
    }

    form.reset();
    Object.values(fields).forEach((field) => {
      field.input.removeAttribute("aria-invalid");
      field.error.textContent = "";
    });
    formStatus.textContent = "Cadastro realizado! Você já está concorrendo a 5 kg de polpa grátis.";
  } catch (error) {
    formStatus.classList.add("is-error");
    formStatus.textContent =
      error.name === "AbortError"
        ? "O envio demorou mais que o esperado. Tente novamente."
        : error.message || "Não foi possível concluir seu cadastro. Tente novamente.";
  } finally {
    window.clearTimeout(timeout);
    submitButton.disabled = false;
    submitButton.textContent = originalButtonText;
  }
});
