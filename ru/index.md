---
layout: home
title: Rapira
description: Rapira — сервер приложений для PHP, написанный на Rust.
tagline: Сервер для PHP-приложений, написанный на Rust.
pitch: Не артефакт вайбкоддинга, а продуманная архитектура и выверенный код, подкреплённые годами работы над RoadRunner.

features:
  - title: Нулевой интероп
    details: "Между Rust и PHP нет прослойки: ни FastCGI, ни сокетов, ни Goridge, ни CGO, ни какой-либо сериализации."
  - title: Совместимость с php-fpm
    details: "Поддерживается классический SAPI: Rapira встаёт на место php-fpm без правок в коде, но работает быстрее."
  - title: Четыре режима работы
    details: "Classic → Franken → RoadRunner → Async<br>На что способно ваше приложение?"
---

<div class="sponsors-section">
  <h2 class="sponsors-title">Спонсоры</h2>
  <div class="sponsors-grid">
    <a href="https://buhta.com" class="sponsor-card sponsor-logo" target="_blank" rel="noopener">
      <img src="/sponsors/logo-buhta.svg" alt="Buhta" class="sponsor-image">
    </a>
  </div>
  <div class="sponsor-cta-link">
    <a href="/ru/sponsor">Стать спонсором</a>
    <span class="separator">|</span>
    <a href="https://github.com/rapira-rs/rapira" target="_blank" rel="noopener">Поставить звезду</a>
  </div>
</div>
