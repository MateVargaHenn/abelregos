<?php

declare(strict_types=1);

use Dotenv\Dotenv;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Factory\AppFactory;

require dirname(__DIR__) . '/vendor/autoload.php';

Dotenv::createImmutable(dirname(__DIR__))->safeLoad();

$app = AppFactory::create();
$app->setBasePath('/api');

$app->addBodyParsingMiddleware();
$app->addRoutingMiddleware();

$errors = $app->addErrorMiddleware(false, true, true);
$errors->getDefaultErrorHandler()->forceContentType('application/json');

$app->get('/health', static function (
    Request $request,
    Response $response
): Response {
    $response->getBody()->write(json_encode([
        'status' => 'ok',
        'service' => 'abelregos-api',
    ], JSON_THROW_ON_ERROR));

    return $response
        ->withHeader('Content-Type', 'application/json; charset=utf-8')
        ->withHeader('Cache-Control', 'no-store');
});

$app->run();