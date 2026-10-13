# Prompter

Autonomiczny prompter tekstu (PWA, offline, bez backendu). Projekt: [dokument projektowy](https://claude.ai/code/artifact/948bd202-2431-44b1-88ca-c3edb271063d).

## Funkcje (wersja 0.2)

- Edytor z biblioteką tekstów zapisywaną lokalnie (IndexedDB), import .txt, zapamiętanie ostatniej pozycji.
- Tryb A: przewijanie z linią odczytu w stałym miejscu ekranu.
- Tryb B: jedno słowo, litera ORP zawsze w tym samym punkcie.
- Prędkość 50–1000 słów/min, zmiana w trakcie bez skoku tekstu, rozbieg po starcie i pauzie, odliczanie.
- Sterowanie: klawiatura, pilot prezentacyjny (PageUp, PageDown, B, kropka, F5), dotyk, przyciski na ekranie.
- Kopia całej biblioteki do pliku .json i import z niej (nowsza wersja tekstu wygrywa), pobranie bieżącego tekstu jako .txt.
- Zmiana wyglądu w trakcie odtwarzania: czcionka, punkt odczytu, szerokość kolumny, bez zatrzymywania.
- Uczenie klawiszy: dowolny przycisk pilota można przypisać do akcji w sekcji „Sterowanie i pilot”.
- Ikony PNG 192 i 512 px oraz ikona dla iOS (instalacja PWA).
- Pełny ekran, blokada wygaszania ekranu (Screen Wake Lock), praca offline po pierwszym otwarciu (Service Worker).

## Nagrywanie wideo

Włączane w edytorze, sekcja „Nagrywanie wideo”. Kamera i mikrofon przez `getUserMedia`, zapis przez `MediaRecorder`, bez serwera i bez sieci.

- Tekst przesuwa się jak najbliżej obiektywu: przy kamerze nad ekranem punkt odczytu domyślnie 10% od góry, przy kamerze z boku (telefon poziomo) kolumna przy tej krawędzi. Kolumna węższa (24 znaki), żeby wzrok mniej uciekał na boki. Bez trybu lustrzanego tekstu.
- Nagrywanie startuje razem z odliczaniem i kończy się 2 s po ostatnim słowie; R włącza i wyłącza je ręcznie. Pauza tekstu nie przerywa nagrania.
- Plik zapisuje się od razu po zatrzymaniu (pobieranie), także przy wyjściu z odtwarzacza w trakcie nagrania. Na telefonie dodatkowo przycisk „Udostępnij / zapisz w galerii”.
- Podgląd kamery (P) widoczny w pauzie, w trakcie czytania ukryty (do zmiany w ustawieniach). Podgląd może być lustrzany, plik nigdy nie jest odbijany.
- Przycisk „Sprawdź kamerę” pokazuje podgląd, faktyczną rozdzielczość i format, który zostanie użyty w tej przeglądarce.

Format pliku: pierwszy obsługiwany z listy MP4 H.264/AAC, MP4, WebM VP9/Opus, WebM VP8/Opus, WebM. Sprawdzone w Chromium 141 (Playwright, sztuczna kamera): wybrany `video/mp4`, plik MP4 z VP9 i Opus, 1920×1080, czas trwania zapisany w pliku. WebM z Chromium nie ma zapisanego czasu trwania, dlatego MP4 jest pierwszy. Chrome, Edge, Safari i Firefox na prawdziwych urządzeniach nie były sprawdzane.

Ograniczenie: nagranie jest trzymane w pamięci do zatrzymania (przy 1080p ok. 60 MB na minutę).

## Sterowanie

| Klawisz | Akcja |
| --- | --- |
| Spacja, Enter, B, kropka, F5 | Start / pauza |
| Strzałka w górę / w dół | Prędkość +10 / −10 słów/min |
| Strzałka w lewo / w prawo | Poprzednie / następne zdanie |
| PageUp / PageDown | Poprzedni / następny akapit |
| Home | Początek tekstu |
| T | Zmiana trybu A / B |
| R | Nagrywanie start / stop (gdy włączone) |
| P | Podgląd kamery pokaż / ukryj |
| F | Pełny ekran |
| + / − | Większa / mniejsza czcionka |
| [ / ] | Punkt odczytu wyżej / niżej |
| ; / ' | Węższa / szersza kolumna (tryb A) |
| Escape | Powrót do edytora |

Przy włączonym nagrywaniu [ ] oraz ; ' zmieniają ustawienia nagrywania (punkt odczytu przy kamerze u góry, kolumna przy nagrywaniu); przy kamerze z boku punkt odczytu jest stały.

Własne przypisania (np. przyciski pilota) ustawia się w edytorze, w sekcji „Sterowanie i pilot”, i mają pierwszeństwo przed domyślnymi.

Dotyk: stuknięcie = start / pauza, przesunięcie w górę lub w dół = prędkość, w lewo lub w prawo = zdanie.

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
| `src/core/` | Rdzeń bez DOM: tokenizer, ORP, harmonogram, zegar, nawigacja, przewijanie (sekcja 6 dokumentu) |
| `src/app/` | Edytor, odtwarzacz, renderery trybów A i B, ustawienia, magazyn tekstów |
| `public/` | Manifest PWA, ikony (SVG i PNG), Service Worker |
| `test/` | Testy jednostkowe rdzenia, klawiszy i kopii biblioteki (vitest) |
