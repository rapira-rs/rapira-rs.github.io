---
layout: home
title: Rapira
description: Rapira es un servidor de aplicaciones PHP escrito en Rust.
tagline: Un servidor de aplicaciones PHP escrito en Rust.
pitch: Los mantenedores de RoadRunner diseñan e implementan Rapira.

features:
  - title: Llamadas directas entre Rust y PHP
    details: "No hay ninguna capa entre Rust y PHP: ni FastCGI, ni sockets, ni Goridge, ni CGO, ni serialización de ningún tipo."
  - title: Compatible con php-fpm
    details: "El modo Classic ejecuta un script de entrada existente, como public/index.php, con un estado nuevo para cada petición. Rapira puede reemplazar a php-fpm."
  - title: Modos de ejecución
    details: "Classic → Worker → Dispatcher<br>¿Qué modos puede usar tu aplicación?"
    link: /es/docs/execution-modes
  - title: Servidor gRPC
    details: "El plugin gRPC atiende llamadas unarias sobre gRPC, gRPC-Web y Connect. PHP procesa las llamadas en el modo Dispatcher."
    link: /es/docs/grpc
---

<script setup>
// `ready: false` identifica las funciones que Rapira no admite.
// El componente muestra estas etiquetas con un estilo atenuado.
const httpFeatures = [
  { label: 'HTTP/1.1' },
  { label: 'Keep-alive' },
  { label: 'Archivos estáticos' },
  { label: 'HTTP/2', ready: false },
  { label: 'HTTP/3', ready: false },
  { label: 'TLS 1.3', ready: false },
  { label: 'TLS 1.2', ready: false },
  { label: 'ALPN', ready: false },
  { label: 'Early Hints', ready: false },
  { label: 'Trailers', ready: false },
]

// Cada pestaña describe una conexión entre un servidor y PHP.
// Los slots de <TextTabs> más abajo contienen las descripciones.
const interopTabs = [
  { name: 'FastCGI', slot: 'fastcgi', users: ['php-fpm', 'nginx', 'Angie'] },
  { name: 'Goridge', slot: 'goridge', users: ['RoadRunner'] },
  { name: 'CGO', slot: 'cgo', users: ['FrankenPHP'] },
  { name: 'C ABI', slot: 'cabi', users: ['Rapira'] },
]
</script>

<RapiraSection title="Un servidor HTTP integrado que usa hyper" link="/es/docs/http" link-text="Peticiones y respuestas HTTP">

PHP no incluye un servidor HTTP para producción. Su servidor integrado es una herramienta de desarrollo. php-fpm necesita un servidor web separado, como nginx.

Rapira incluye un servidor HTTP que usa la biblioteca de Rust [hyper](https://hyper.rs). Hyper lee cada petición y escribe la respuesta de Rapira.

<template #footer>
<FeatureTags :items="httpFeatures" />
</template>

</RapiraSection>

<RapiraSection title="Rust llama a PHP directamente" link="/es/docs/process-model" link-text="Modelo de procesos">

Rapira usa Rust, y PHP usa C. Rust llama a funciones de C directamente. Por tanto, Rust puede llamar a una función de PHP directamente. Rapira incrusta el intérprete en el proceso del servidor. Los bindings directos controlan la inicialización del intérprete y el procesamiento de las peticiones.

Rapira no usa FastCGI, Goridge ni CGO. No serializa las peticiones ni las envía a otro proceso. En los modos Classic y Worker, Rapira rellena las superglobales directamente.

<template #aside>
<TextTabs :tabs="interopTabs">
<template #fastcgi>

PHP se ejecuta en procesos separados. El servidor web envía registros FastCGI a través de un socket. El proceso PHP analiza cada petición y devuelve una respuesta serializada.

</template>
<template #goridge>

Los workers de PHP son procesos separados. Reciben del servidor peticiones serializadas a través de pipes o sockets. Goridge define el formato de estos datos.

</template>
<template #cgo>

El proceso del servidor contiene el intérprete de PHP. Pero su host en Go no puede llamar a código C directamente. CGO procesa cada llamada entre los dos lenguajes.

</template>
<template #cabi>

Una ABI define cómo se llaman entre sí los lenguajes compilados. Rust admite la ABI de C directamente. Rust y C usan las mismas instrucciones de máquina para estas llamadas.

</template>
</TextTabs>
</template>

</RapiraSection>

<div class="sponsors-section">
  <h2 class="sponsors-title">Patrocinadores</h2>
  <div class="sponsors-grid">
    <a href="https://buhta.com" class="sponsor-card sponsor-logo" target="_blank" rel="noopener">
      <img src="/sponsors/logo-buhta.svg" alt="Buhta" class="sponsor-image">
    </a>
  </div>
  <div class="sponsor-cta-link">
    <a href="/es/sponsor">Conviértete en patrocinador</a>
    <span class="separator">|</span>
    <a href="https://github.com/rapira-rs/rapira" target="_blank" rel="noopener">Danos una estrella</a>
  </div>
</div>
