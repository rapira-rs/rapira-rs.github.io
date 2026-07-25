# Pierwsze kroki

Witaj w dokumentacji Rapiry. Ta strona jest zarazem żywą prezentacją: każdy blok poniżej powstaje z tego samego Markdownu, który będziesz pisać na własnych stronach.

## Bloki z wyróżnieniem

Otocz tekst kontenerem `:::`, aby uzyskać kolorowe wyróżnienie z ikoną:

```md
::: tip
Przydatna rada, którą warto podkreślić.
:::
::: info
Neutralna informacja kontekstowa.
:::
::: warning
Coś, na co trzeba uważać.
:::
::: danger
Realne ryzyko — działaj ostrożnie.
:::
```

::: tip
Przydatna rada, którą warto podkreślić.
:::

::: info
Neutralna informacja kontekstowa.
:::

::: warning
Coś, na co trzeba uważać.
:::

::: danger
Realne ryzyko — działaj ostrożnie.
:::

Zaraz po typie możesz podać własny tytuł:

::: tip Wskazówka
Nadaj blokowi własny tytuł, gdy domyślna etykieta nie wystarcza.
:::

## Bloki kodu

Kod w bloku otrzymuje podświetlanie składni, etykietę języka i przycisk kopiowania:

```rust
fn main() {
    println!("Hello, Rapira!");
}
```

Skieruj uwagę czytelnika na konkretne wiersze — podświetl je, ustaw fokus albo pokaż zmiany:

```rust{3}
fn main() {
    let answer = 42;
    println!("The answer is {answer}"); // ten wiersz jest podświetlony
}
```

```rust
fn main() {
    let ready = true;      // [!code focus]
    println!("{ready}");
}
```

```rust
fn setup() {
    let retries = 1;       // [!code --]
    let retries = 3;       // [!code ++]
}
```

Zbierz warianty tego samego polecenia w zakładki:

::: code-group

```bash [npm]
npm install
```

```bash [pnpm]
pnpm install
```

```bash [yarn]
yarn
```

:::

## Diagramy

Blok `mermaid` renderuje się jako diagram:

```mermaid
flowchart LR
  A[Piszesz Markdown] --> B{Budowanie}
  B --> C[Statyczna strona]
  B --> D[Kanał RSS]
```

## Tabele i plakietki

Zwykłe tabele Markdown działają od razu:

| Funkcja          | W zestawie |
| ---------------- | :--------: |
| Wyróżnienia      |     ✅     |
| Grupy kodu       |     ✅     |
| Mermaid          |     ✅     |
| Spoilery FAQ     |     ✅     |

Plakietki w tekście świetnie nadają się do oznaczania statusu: <Badge type="tip" text="nowość" /> <Badge type="warning" text="beta" /> <Badge type="danger" text="wycofane" />.

## Pytania (spoilery FAQ)

Napisz blok `::: question` w dowolnym miejscu strony:

```md
::: question Jak uruchomić stronę lokalnie?
Raz `npm install`, a potem `npm run dev`.
:::
```

Silnik wyławia z tekstu wszystkie pytania i zbiera je w rozwijane spoilery na końcu sekcji — takie jak poniżej.

::: question Jak uruchomić stronę lokalnie?
Uruchom raz `npm install`, a potem `npm run dev` i otwórz wyświetlony lokalny adres.
:::

::: question Gdzie są tłumaczenia?
Każdy język ma własny katalog — `ru/`, `es/`, `zh/`, `pl/` — o tej samej strukturze co wersja angielska. Angielski jest źródłem prawdy.
:::
