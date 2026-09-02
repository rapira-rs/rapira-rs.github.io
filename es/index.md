---
layout: home
title: Rapira
description: Rapira es un servidor de aplicaciones PHP escrito en Rust.
tagline: Un servidor de aplicaciones PHP, escrito en Rust.
pitch: Una arquitectura pensada y código escrito con cuidado, con años de RoadRunner detrás.

features:
  - title: Interop cero
    details: "Entre Rust y PHP no hay ninguna capa intermedia: ni FastCGI, ni sockets, ni Goridge, ni CGO, ni serialización de ningún tipo."
  - title: Compatible con php-fpm
    details: "Admite el SAPI clásico: Rapira ocupa el lugar de php-fpm sin tocar el código, pero va más rápido."
  - title: Modos de ejecución
    details: "Classic → Worker → Dispatcher<br>¿Hasta dónde llega tu aplicación?"
    link: /es/docs/execution-modes
---

<script setup>
// Lo que lleva el frontal HTTP: `ready: false` marca lo que Rapira todavía
// no sirve; esas etiquetas se dibujan atenuadas.
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

// Cuatro formas de conectar un servidor con PHP — una pestaña por cada una.
// Los textos de las pestañas van en los slots de <TextTabs> más abajo.
const interopTabs = [
  { name: 'FastCGI', slot: 'fastcgi', users: ['php-fpm', 'nginx', 'Angie'] },
  { name: 'Goridge', slot: 'goridge', users: ['RoadRunner'] },
  { name: 'CGO', slot: 'cgo', users: ['FrankenPHP'] },
  { name: 'C ABI', slot: 'cabi', users: ['Rapira'] },
]
</script>

<RapiraSection title="Servidor HTTP integrado, potenciado por hyper" link="/es/docs/http" link-text="Peticiones y respuestas HTTP">

Resulta paradójico, pero PHP nunca ha tenido un servidor HTTP propio listo para producción: el integrado es solo una herramienta de desarrollo, y php-fpm no funciona sin un servidor web externo como nginx.

Rapira aporta ese servidor: un frontal HTTP propio, escrito en Rust sobre [hyper](https://hyper.rs). La biblioteca hyper es una implementación de HTTP de bajo nivel para Rust. Lee cada petición de la conexión y devuelve por ella la respuesta que produce Rapira.

<template #footer>
<FeatureTags :items="httpFeatures" />
</template>

</RapiraSection>

<RapiraSection title="Interop cero: Rust llama a PHP directamente" link="/es/docs/process-model" link-text="Modelo de procesos">

Rapira está escrita en Rust; PHP, en C. Rust llama a las funciones de C de forma nativa. Por tanto, llamar a una función de PHP desde Rust es una llamada directa. El intérprete va incrustado en el proceso del servidor. Rapira lo controla mediante bindings directos, desde el arranque del motor hasta cada petición.

Aquí no hay FastCGI, ni Goridge, ni CGO: la petición no se serializa en ningún punto y nunca sale del proceso. En los modos Classic y Worker, Rapira rellena las superglobales directamente.

<template #aside>
<TextTabs :tabs="interopTabs">
<template #fastcgi>

PHP se ejecuta en procesos separados y el servidor web se comunica con ellos por un socket mediante un protocolo binario: cada petición se empaqueta en registros FastCGI, viaja y se desempaqueta al otro lado, y la respuesta hace el mismo camino de vuelta.

</template>
<template #goridge>

Los workers de PHP son procesos separados que reciben las peticiones del servidor a través de pipes o sockets. Goridge es el protocolo de ese intercambio: cada petición y cada respuesta se serializa en un lado y se interpreta en el otro.

</template>
<template #cgo>

El intérprete de PHP va incrustado en el proceso del servidor, pero el host está escrito en Go, y Go no puede llamar a código C directamente. Cada llamada pasa por CGO, una capa que añade sobrecarga cada vez que se cruza la frontera entre lenguajes.

</template>
<template #cabi>

La ABI es el contrato binario entre lenguajes compilados. Rust admite la ABI de C de forma nativa: una llamada a una función de C desde Rust se compila al mismo código máquina que una llamada hecha desde el propio C.

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
