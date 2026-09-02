---
title: Czym jest Rapira?
description: "Rapira to szybki i bezpieczny serwer aplikacji PHP napisany w Ruście: przyjmuje żądania HTTP bezpośrednio i obsługuje tryby Classic, Worker oraz Dispatcher."
---

# Czym jest Rapira

Rapira to szybki i bezpieczny serwer aplikacji PHP napisany w Ruście.

Lata utrzymywania RoadRunnera ukształtowały projekt Rapiry. Rapira współpracuje z PHP wydajnie i stabilnie. Ten sam projekt upraszcza rozwój i eksploatację.

Rapira nie kończy się na HTTP. W planach mamy obsługę wszystkich popularnych wtyczek RoadRunnera, a o nowościach piszemy na naszym [blogu](/pl/blog/).

## HTTP

Rapira ma własny front HTTP, zbudowany na bibliotece [hyper](https://hyper.rs). Front przyjmuje nieszyfrowane połączenia HTTP bezpośrednio, więc do twojej aplikacji PHP nic nie musi stać przed nim. Front nie obsługuje TLS-a. Jeśli potrzebujesz TLS-a, zakończ go na proxy stojącym przed Rapirą; taką konfigurację opisuje [Wdrożenie produkcyjne](/pl/docs/deployment).

Po stronie PHP dostępne są wszystkie modele pracy:

- Classic: każde żądanie uruchamia aplikację od zera, tak samo jak pod php-fpm.
- Worker: aplikacja startuje raz, przy uruchomieniu serwera, a potem w pętli obsługuje żądanie za żądaniem. Rapira wypełnia superglobale PHP na nowo przy każdym żądaniu.
- Dispatcher: aplikacja startuje raz i nie kończy pracy. Skrypt pobiera każde żądanie wywołaniem API i pracuje na nim jak na zwykłej wartości, a nie na zmiennych superglobalnych. Obsługuje po jednym żądaniu naraz albo kilka jednocześnie, dzięki [fiberom](https://www.php.net/manual/en/language.fibers.php).

::: info
Na stronie [Tryby wykonania](/pl/docs/execution-modes) znajdziesz szczegółowe porównanie trybów i wskazówki, który wybrać.
:::
