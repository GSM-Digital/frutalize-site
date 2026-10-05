<?php

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function send_json(int $statusCode, array $payload): void
{
    http_response_code($statusCode);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function clean_text($value, int $maximumLength): string
{
    if (!is_string($value)) {
        return '';
    }

    $value = preg_replace('/[\r\n\x00]+/u', ' ', $value) ?? '';
    $value = preg_replace('/\s+/u', ' ', trim($value)) ?? '';

    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, $maximumLength, 'UTF-8');
    }

    return substr($value, 0, $maximumLength);
}

function protect_csv_formula(string $value): string
{
    return preg_match('/^[=+\-@]/u', $value) === 1 ? "'" . $value : $value;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    send_json(405, ['message' => 'Método não permitido.']);
}

$contentType = $_SERVER['CONTENT_TYPE'] ?? '';
if (stripos($contentType, 'application/json') !== 0) {
    send_json(415, ['message' => 'Formato de envio não aceito.']);
}

$rawBody = file_get_contents('php://input');
if ($rawBody === false || strlen($rawBody) > 20480) {
    send_json(413, ['message' => 'Conteúdo muito grande.']);
}

$body = json_decode($rawBody, true);
if (!is_array($body)) {
    send_json(400, ['message' => 'Conteúdo inválido.']);
}

$name = clean_text($body['name'] ?? '', 100);
$phone = clean_text($body['phone'] ?? '', 20);
$email = strtolower(clean_text($body['email'] ?? '', 254));
$phoneDigits = preg_replace('/\D+/', '', $phone) ?? '';

if (
    strlen($name) < 2 ||
    strlen($phoneDigits) < 10 ||
    strlen($phoneDigits) > 11 ||
    filter_var($email, FILTER_VALIDATE_EMAIL) === false
) {
    send_json(422, ['message' => 'Confira os dados informados e tente novamente.']);
}

$dataDirectory = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'dados';
$leadsFile = $dataDirectory . DIRECTORY_SEPARATOR . 'leads.csv';

try {
    if (!is_dir($dataDirectory) && !mkdir($dataDirectory, 0700, true) && !is_dir($dataDirectory)) {
        throw new RuntimeException('Não foi possível criar a pasta de dados.');
    }

    $handle = fopen($leadsFile, 'c+');
    if ($handle === false) {
        throw new RuntimeException('Não foi possível abrir o arquivo de leads.');
    }

    if (!flock($handle, LOCK_EX)) {
        fclose($handle);
        throw new RuntimeException('Não foi possível bloquear o arquivo de leads.');
    }

    clearstatcache(true, $leadsFile);
    if (filesize($leadsFile) === 0) {
        fputcsv($handle, ['data_envio', 'nome', 'telefone', 'email']);
    }

    fseek($handle, 0, SEEK_END);
    $saved = fputcsv($handle, [
        gmdate('c'),
        protect_csv_formula($name),
        protect_csv_formula($phone),
        protect_csv_formula($email),
    ]);

    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);
    chmod($leadsFile, 0600);

    if ($saved === false) {
        throw new RuntimeException('Não foi possível gravar o cadastro.');
    }

    send_json(201, ['message' => 'Cadastro realizado com sucesso.']);
} catch (Throwable $error) {
    error_log('Falha ao salvar lead: ' . $error->getMessage());
    send_json(500, ['message' => 'Não foi possível salvar o cadastro. Tente novamente.']);
}
