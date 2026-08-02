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
    details: "Classic → Worker → Async<br>¿Hasta dónde llega tu aplicación?"
    link: /es/docs/execution-modes
---

<script setup>
import { VPImage } from 'vitepress/theme'

// El banner de Pingora a la derecha del texto — decoración, una variante por
// tema. Los archivos van en public/ con estos nombres.
const pingoraBanner = {
  light: '/pingora-banner-light.png',
  dark: '/pingora-banner-dark.png',
  alt: 'Pingora',
}

// Lo que Pingora aporta al binario: `ready: false` marca lo que Rapira todavía
// no sirve — esas etiquetas se dibujan atenuadas.
const httpFeatures = [
  { label: 'HTTP/1.1' },
  { label: 'HTTP/2', ready: false },
  { label: 'HTTP/3', ready: false },
  { label: 'Keep-alive' },
  { label: 'Early Hints' },
  { label: 'Trailers', ready: false },
  { label: 'TLS 1.3', ready: false },
  { label: 'TLS 1.2', ready: false },
  { label: 'ALPN', ready: false },
]
</script>

<RapiraSection title="Servidor HTTP integrado, potenciado por Pingora" link="/es/docs/http" link-text="Peticiones y respuestas HTTP">

Resulta paradójico, pero PHP nunca ha tenido un servidor HTTP propio listo para producción: el integrado es solo una herramienta de desarrollo, y php-fpm no funciona sin un servidor web externo como nginx.

Ahora ya lo tiene: un servidor moderno y rápido, construido sobre [Pingora](https://github.com/cloudflare/pingora). Con ese framework Cloudflare atiende una parte considerable del tráfico de todo internet.

<template #aside>
<div class="rapira-section-art">
<VPImage :image="pingoraBanner" draggable="false" />
</div>
</template>

<template #footer>
<FeatureTags :items="httpFeatures" />
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
