# Prompter

Autonomiczny prompter tekstu (PWA, offline, bez backendu). Projekt: [dokument projektowy](https://claude.ai/code/artifact/948bd202-2431-44b1-88ca-c3edb271063d).

## Funkcje (wersja 0.1)

- Edytor z biblioteką tekstów zapisywaną lokalnie (IndexedDB), import .txt, zapamiętanie ostatniej pozycji.
- Tryb A: przewijanie z linią odczytu w stałym miejscu ekranu.
- Tryb B: jedno słowo, litera ORP zawsze w tym samym punkcie.
- Prędkość 50–1000 słów/min, zmiana w trakcie bez skoku tekstu, rozbieg po starcie i pauzie, odliczanie.
- Sterowanie: klawiatura, pilot prezentacyjny (PageUp, PageDown, B, kropka, F5), dotyk, przyciski na ekranie.
- Pełny ekran, blokada wygaszania ekranu (Screen Wake Lock), praca offline po pierwszym otwarciu (Service Worker).
- Opcjonalnie: podążanie za głosem (Web Speech API). Tekst przesuwa się za czytającym, przy ciszy stoi. Opis niżej.

## Sterowanie

| Klawisz | Akcja |
| --- | --- |
| Spacja, Enter, B, kropka, F5 | Start / pauza |
| Strzałka w górę / w dół | Prędkość +10 / −10 słów/min |
| Strzałka w lewo / w prawo | Poprzednie / następne zdanie |
| PageUp / PageDown | Poprzedni / następny akapit |
| Home | Początek tekstu |
| T | Zmiana trybu A / B |
| F | Pełny ekran |
| Escape | Powrót do edytora |

Dotyk: stuknięcie = start / pauza, przesunięcie w górę lub w dół = prędkość, w lewo lub w prawo = zdanie.

## Podążanie za głosem

Włączane w ustawieniach („Podążanie za głosem”, domyślnie wyłączone). Start i pauza włączają i wyłączają mikrofon; nawigacja klawiszami działa jak zwykle, a dopasowanie zaczyna od nowej pozycji.

- **Prywatność i sieć.** Rozpoznawanie wykonuje usługa przeglądarki. W Chrome dźwięk z mikrofonu jest wysyłany do serwerów Google (`https://www.google.com/speech-api/full-duplex/v1` w kodzie Chromium). Funkcja nie działa offline; reszta aplikacji tak.
- **Przeglądarki** (mdn/browser-compat-data): Chrome i Edge na komputerze, Chrome na Androidzie (tam `continuous` nie działa, więc słuchanie jest wznawiane po każdej wypowiedzi), Safari 14.1+ z prefiksem `webkit`. Firefox tylko po włączeniu flagi `media.webspeech.recognition.enable`.
- **Wymaga HTTPS** albo `localhost` (dostęp do mikrofonu).
- **Algorytm** (`src/core/voice.ts`): ostatnie do 8 rozpoznanych słów jest dopasowywanych do tekstu w oknie od 15 słów przed do 40 słów za oczekiwaną pozycją (lokalne dopasowanie sekwencji, porównanie słów bez wielkości liter, diakrytyków i interpunkcji, tolerancja Levenshteina ≥ 0,7). Krótkie słowa (i, w, na) mają niską wagę; skok wstecz o więcej niż 2 słowa wymaga 3 zgodnych słów. Pozycja tekstu dąży płynnie do dopasowanego miejsca z wyprzedzeniem najwyżej 1 słowa wynikającym z tempa mówienia. Wszystkie progi są heurystyczne [H] i wymagają strojenia na nagraniach.

## Uruchomienie

```
npm install
npm run dev        # serwer deweloperski
npm test           # testy jednostkowe rdzenia
npm run typecheck
npm run build      # wynik w dist/
npm run preview    # podgląd zbudowanej wersji (z Service Workerem)
```

Service Worker działa tylko przez HTTPS albo na `localhost`.

## Publikacja na GitHub Pages

Workflow `.github/workflows/pages.yml` publikuje `dist/` po każdym wypchnięciu na `main`. Jednorazowo trzeba włączyć: Settings → Pages → Source: GitHub Actions. Adres: `https://<właściciel>.github.io/<repozytorium>/`.

## Struktura

| Katalog | Zawartość |
| --- | --- |
| `src/core/` | Rdzeń bez DOM: tokenizer, ORP, harmonogram, zegar, nawigacja, przewijanie (sekcja 6 dokumentu), dopasowanie mowy do tekstu |
| `src/app/` | Edytor, odtwarzacz, renderery trybów A i B, ustawienia, magazyn tekstów, adapter rozpoznawania mowy |
| `public/` | Manifest PWA, ikona, Service Worker |
| `test/` | Testy jednostkowe rdzenia (vitest) |
