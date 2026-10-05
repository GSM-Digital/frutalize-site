const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const rootDirectory = __dirname;
const dataDirectory = path.join(rootDirectory, "dados");
const leadsFile = path.join(dataDirectory, "leads.csv");
const port = Number(process.env.PORT) || 4173;
const host = process.env.HOST || "127.0.0.1";
const bodyLimit = 20 * 1024;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ttf": "font/ttf",
};

let writeQueue = Promise.resolve();

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function cleanText(value, maximumLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n\0]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximumLength);
}

function protectCsvFormula(value) {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function toCsvRow(values) {
  return `${values
    .map((value) => `"${protectCsvFormula(String(value)).replace(/"/g, '""')}"`)
    .join(",")}\n`;
}

async function saveLead(lead) {
  await fs.promises.mkdir(dataDirectory, { recursive: true, mode: 0o700 });

  try {
    await fs.promises.access(leadsFile, fs.constants.F_OK);
  } catch {
    await fs.promises.writeFile(leadsFile, "data_envio,nome,telefone,email\n", {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
  }

  await fs.promises.appendFile(
    leadsFile,
    toCsvRow([new Date().toISOString(), lead.name, lead.phone, lead.email]),
    "utf8",
  );
}

function receiveJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > bodyLimit) {
        const error = new Error("Payload muito grande.");
        error.statusCode = 413;
        reject(error);
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        const error = new Error("Conteúdo inválido.");
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

async function handleLead(request, response) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.startsWith("application/json")) {
    sendJson(response, 415, { message: "Formato de envio não aceito." });
    return;
  }

  try {
    const body = await receiveJson(request);
    const lead = {
      name: cleanText(body.name, 100),
      phone: cleanText(body.phone, 20),
      email: cleanText(body.email, 254).toLowerCase(),
    };
    const phoneDigits = lead.phone.replace(/\D/g, "");
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email);

    if (lead.name.length < 2 || phoneDigits.length < 10 || phoneDigits.length > 11 || !validEmail) {
      sendJson(response, 422, { message: "Confira os dados informados e tente novamente." });
      return;
    }

    writeQueue = writeQueue.catch(() => {}).then(() => saveLead(lead));
    await writeQueue;
    sendJson(response, 201, { message: "Cadastro realizado com sucesso." });
  } catch (error) {
    if (error.statusCode) {
      sendJson(response, error.statusCode, { message: error.message });
      return;
    }

    console.error("Falha ao salvar lead:", error.message);
    sendJson(response, 500, { message: "Não foi possível salvar o cadastro. Tente novamente." });
  }
}

function serveStaticFile(request, response, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  let decodedPath;

  try {
    decodedPath = decodeURIComponent(requestedPath);
  } catch {
    response.writeHead(400).end("Requisição inválida.");
    return;
  }

  const privatePaths = new Set(["/.gitignore", "/package.json", "/server.js"]);
  if (decodedPath.startsWith("/dados/") || decodedPath === "/dados" || privatePaths.has(decodedPath)) {
    response.writeHead(404).end("Não encontrado.");
    return;
  }

  const filePath = path.resolve(rootDirectory, `.${decodedPath}`);
  if (!filePath.startsWith(`${rootDirectory}${path.sep}`)) {
    response.writeHead(403).end("Acesso negado.");
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      response.writeHead(404).end("Não encontrado.");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    fs.createReadStream(filePath).pipe(response);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (url.pathname === "/api/leads" || url.pathname === "/api/leads.php") {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      sendJson(response, 405, { message: "Método não permitido." });
      return;
    }

    await handleLead(request, response);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end("Método não permitido.");
    return;
  }

  serveStaticFile(request, response, url.pathname);
});

server.listen(port, host, () => {
  console.log(`Frutalize disponível em http://${host}:${port}`);
  console.log(`Os cadastros serão salvos em ${leadsFile}`);
});
