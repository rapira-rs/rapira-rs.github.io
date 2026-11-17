---
title: "Wczytywanie zestawu deskryptorów gRPC z adresu URL"
date: 2026-11-17
description: "Klucz descriptor_set nasłuchu gRPC przyjmuje ścieżkę lokalną albo adres URL HTTP lub HTTPS. Ten wpis porównuje obie formy i wymienia ograniczenia formy URL."
author: Rapira Team
image: /blog/grpc-descriptor-set-url/preview.png
---

# Wczytywanie zestawu deskryptorów gRPC z adresu URL

Rapira odczytuje schemat gRPC z zestawu deskryptorów. Jest to jeden plik binarny, który zawiera skompilowane pliki `.proto` razem z ich importami. Buf nazywa ten plik obrazem. Klucz `descriptor_set` w `[grpc]` przyjmuje teraz dwie formy: ścieżkę lokalną oraz adres URL HTTP lub HTTPS.

::: info
Forma URL wymaga wersji Rapira nowszej niż 0.9.2.
:::

## Co Rapira robi z zestawem

Rapira używa zestawu, aby znaleźć usługi i ich metody, konwertować komunikaty Connect JSON i odpowiadać na żądania refleksji. Proces nadrzędny wczytuje zestaw jeden raz przy starcie, przed forkowaniem workerów. Zestaw, którego Rapira nie może wczytać, zatrzymuje start. Rapira nie potrzebuje do tego programu `protoc`.

## Forma ścieżki

```toml
[grpc]
descriptor_set = "api.binpb"
```

Ścieżka względna używa katalogu `rapira.toml` jako podstawy. Plik musi być na hoście lub w kontenerze, zanim Rapira się uruchomi. Są trzy typowe sposoby, aby go tam umieścić:

- Zbuduj zestaw w potoku CI aplikacji i skopiuj go do obrazu kontenera.
- Zamontuj zestaw z woluminu lub obiektu ConfigMap. ConfigMap [nie może zawierać więcej niż 1 MiB](https://kubernetes.io/docs/concepts/configuration/configmap/#motivation).
- Pobierz zestaw w [kontenerze init](https://kubernetes.io/docs/concepts/workloads/pods/init-containers/) lub w skrypcie entrypoint.

Przy dwóch pierwszych sposobach start nie wymaga sieci. Przy trzecim sposobie start wymaga hosta pliku, tak jak w formie URL. Gdy zestaw jest w obrazie, zestaw i kod aplikacji są wdrażane jako jeden artefakt. Kosztem jest jeden dodatkowy krok dla każdej usługi: etap budowania z `buf` lub `protoc` albo skrypt, który pobiera plik.

## Forma URL

```toml
[grpc]
descriptor_set = "https://schemas.example.com/billing/v42/api.binpb"
```

Wartość, która zaczyna się od `http://` lub `https://`, jest adresem URL. Proces nadrzędny pobiera zestaw za pomocą żądania GET przy starcie. [Wejścia obrazów Buf](https://buf.build/docs/reference/inputs/#image-formats) przyjmują zdalną lokalizację w ten sam sposób.

Ta forma pozwala przechowywać zestawy deskryptorów wszystkich usług w jednym miejscu. Potok CI repozytorium `.proto` buduje każdy zestaw jeden raz:

```sh
buf build proto --as-file-descriptor-set -o api.binpb
```

Następnie potok wysyła `api.binpb` na host, który odpowiada na żądanie GET. Przykłady to bucket magazynu obiektów, repozytorium artefaktów i serwer plików statycznych. Każda instancja Rapira wskazuje adres URL w `rapira.toml`.

Rapira sama wykonuje pobieranie. Obraz aplikacji nie zawiera zestawu deskryptorów ani kroku, który go buduje. Pod nie potrzebuje kontenera init ani woluminu dla schematu. Ta sama konfiguracja działa w kontenerze, na maszynie wirtualnej i na komputerze programisty.

## Jak działa pobieranie

- Rapira wysyła żądanie GET i podąża za najwyżej 10 przekierowaniami. Status odpowiedzi 400 lub wyższy zatrzymuje start.
- HTTPS używa systemowego magazynu certyfikatów. `SSL_CERT_FILE` i `SSL_CERT_DIR` wybierają inny magazyn, na przykład dla prywatnego urzędu certyfikacji.
- Rapira wysyła część userinfo adresu URL (`https://user:password@host/api.binpb`) jako poświadczenia HTTP Basic. Wpisy logu pokazują adres URL bez części userinfo i bez zapytania.
- Pobieranie używa proxy, które wskazuje `ALL_PROXY`, `HTTPS_PROXY` lub `HTTP_PROXY`.
- Połączenie, nagłówek odpowiedzi i treść mają osobne limity czasu, każdy po 30 sekund. Maksymalny rozmiar zestawu to 64 MiB.

## Ograniczenia formy URL

Forma URL przenosi jedną zależność z budowania na start każdej instancji. Przeczytaj te ograniczenia, zanim jej użyjesz.

- Start wymaga hosta schematu. Jeśli pobieranie się nie uda, Rapira kończy działanie z kodem 1. Nie ponawia próby i nie przechowuje lokalnej kopii. Supervisor procesów lub orkiestrator musi uruchomić ją ponownie. Błąd nie dotyczy działających instancji, ponieważ nie pobierają one zestawu ponownie.
- Zmieniony zestaw wymaga ponownego uruchomienia. Przeładowanie zachowuje wczytany zestaw. Jeśli zastąpisz plik pod adresem URL, instancje uruchomione w różnym czasie mogą używać różnych zestawów. Umieść wersję w ścieżce adresu URL i zmieniaj adres URL przy każdym wydaniu schematu.
- Rapira nie weryfikuje zawartości. Nie sprawdza sumy kontrolnej ani podpisu. Użyj HTTPS i hosta, któremu ufasz. Przy `http://` każdy host na ścieżce sieciowej może zmienić zestaw.
- Uwierzytelnianie jest proste. Rapira może wysłać poświadczenia HTTP Basic z części userinfo adresu URL. Zapytanie adresu URL też może zawierać poświadczenia, jak we wstępnie podpisanym adresie URL. Rapira nie może wysłać tokena bearer ani podpisać żądania do API magazynu w chmurze. Wstępnie podpisany adres URL ma czas wygaśnięcia, a uruchomienie po tym czasie kończy się błędem. Poświadczenia są w `rapira.toml`, więc chroń ten plik.
- Format jest stały. Treść odpowiedzi musi być binarnym zestawem. Buf potrafi też odczytać skompresowany obraz, na przykład `image.binpb.gz`, ale Rapira tego nie potrafi.
- Rapira nie używa API rejestru schematów. Wysyła zwykłe żądanie GET. Wyeksportuj zestaw z rejestru i wyślij go na host, który odpowiada na żądanie GET.
- Wygenerowane klasy PHP pozostają w aplikacji. Aplikacja, która używa wygenerowanych klas komunikatów, nadal dodaje je do swojego obrazu przy budowaniu. Forma URL usuwa z obrazu tylko zestaw deskryptorów. Utrzymuj klasy i zestaw w tej samej wersji schematu.

## Którą formę wybrać

Użyj ścieżki, gdy zestaw jest dostarczany razem z aplikacją lub gdy Rapira musi uruchomić się bez dostępu do sieci. Użyj adresu URL, gdy wiele usług lub instancji współdzieli jedną lokalizację schematu, a ta lokalizacja ma taką dostępność, jakiej wymagają wdrożenia.

Dokumentację referencyjną znajdziesz na stronie [gRPC](/pl/docs/grpc#descriptor-set-url).
