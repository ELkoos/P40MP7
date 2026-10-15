# Prompter

Autonomiczny prompter tekstu (PWA, offline, bez backendu). Projekt: [dokument projektowy](https://claude.ai/code/artifact/948bd202-2431-44b1-88ca-c3edb271063d).

## Funkcje (wersja 0.2)

- Edytor z biblioteką tekstów zapisywaną lokalnie (IndexedDB), import tekstu z plików .txt, .docx, .odt, .rtf i .pdf (offline; PDF musi mieć warstwę tekstową, skany wymagają OCR; stary .doc nieobsługiwany), zapamiętanie ostatniej pozycji.
- Tryb A: przewijanie z linią odczytu w stałym miejscu ekranu.
- Tryb B: jedno słowo, litera ORP zawsze w tym samym punkcie; w pauzie pod słowem widać całe zdanie z wyróżnionym bieżącym słowem.
- Prędkość 50–1000 słów/min, zmiana w trakcie bez skoku tekstu, rozbieg po starcie i pauzie, odliczanie.
- Dopasowanie prędkości do zadanego czasu (osobne pola minut i sekund, np. 3 i 30), z uwzględnieniem rozbiegu.
- Sterowanie: klawiatura, pilot prezentacyjny (PageUp, PageDown, B, kropka, F5), dotyk, przyciski na ekranie.
- „Eksport ustawień” i „Import ustawień”: plik .json z ustawieniami i całą biblioteką tekstów (import zastępuje ustawienia, przy tekstach nowsza wersja wygrywa; starsze pliki bez ustawień też się wczytują), pobranie bieżącego tekstu jako .txt.
- Zmiana wyglądu w trakcie odtwarzania: czcionka, punkt odczytu, szerokość kolumny, bez zatrzymywania.
- Uczenie klawiszy: dowolny przycisk pilota można przypisać do akcji w sekcji „Sterowanie i pilot”.
- Ikony PNG 192 i 512 px oraz ikona dla iOS (instalacja PWA).
- Pełny ekran, blokada wygaszania ekranu (Screen Wake Lock), praca offline po pierwszym otwarciu (Service Worker).
- Opcjonalnie: podążanie za głosem (Web Speech API). Tekst przesuwa się za czytającym, przy ciszy stoi. Opis niżej.

## Nagrywanie wideo

Włączane w edytorze, sekcja „Nagrywanie wideo”. Kamera i mikrofon przez `getUserMedia`, zapis przez `MediaRecorder`, bez serwera i bez sieci.

- Tekst przesuwa się jak najbliżej obiektywu: przy kamerze nad ekranem punkt odczytu domyślnie 10% od góry, przy kamerze z boku (telefon poziomo) kolumna przy tej krawędzi. Kolumna węższa (24 znaki), żeby wzrok mniej uciekał na boki. Bez trybu lustrzanego tekstu.
- Nagrywanie startuje razem z odliczaniem i kończy się 2 s po ostatnim słowie; R włącza i wyłącza je ręcznie. W trakcie nagrywania w lewym dolnym rogu jest zawsze widoczny przycisk „■ STOP” (mysz i dotyk), także gdy pasek narzędzi jest schowany; zatrzymuje nagranie, zapisuje plik i pauzuje tekst (przy podążaniu za głosem wyłącza też mikrofon). Tak samo działa R, przycisk ● i pilot. Pauza samego tekstu nie przerywa nagrania.
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

## Podążanie za głosem

Włączane w ustawieniach („Podążanie za głosem”, domyślnie wyłączone). Start i pauza włączają i wyłączają mikrofon; nawigacja klawiszami działa jak zwykle, a dopasowanie zaczyna od nowej pozycji.

- **Prywatność i sieć.** Rozpoznawanie wykonuje usługa przeglądarki. W Chrome dźwięk z mikrofonu jest wysyłany do serwerów Google (`https://www.google.com/speech-api/full-duplex/v1` w kodzie Chromium). Funkcja nie działa offline; reszta aplikacji tak.
- **Przeglądarki** (mdn/browser-compat-data): Chrome i Edge na komputerze, Chrome na Androidzie (tam `continuous` nie działa, więc słuchanie jest wznawiane po każdej wypowiedzi), Safari 14.1+ z prefiksem `webkit`. Firefox tylko po włączeniu flagi `media.webspeech.recognition.enable`.
- **Wymaga HTTPS** albo `localhost` (dostęp do mikrofonu).
- **Algorytm** (`src/core/voice.ts`): ostatnie do 8 rozpoznanych słów jest dopasowywanych do tekstu w oknie od 15 słów przed do 40 słów za oczekiwaną pozycją (lokalne dopasowanie sekwencji, porównanie słów bez wielkości liter, diakrytyków i interpunkcji, tolerancja Levenshteina ≥ 0,7). Krótkie słowa (i, w, na) mają niską wagę; skok wstecz o więcej niż 2 słowa wymaga 3 zgodnych słów. Tekst przesuwa się płynnie z prędkością równą tempu mowy (przyrost dopasowań w ostatnich 6 s mowy, przerwy lektora się nie liczą). Cel to ostatnie dopasowanie + tempo × (opóźnienie rozpoznawania, ustawienie „Wyprzedzenie przy głosie”, domyślnie 1000 ms, + czas mowy od tego dopasowania, najwyżej 5 s); różnicę tekst zbiera łagodnie przez zmianę prędkości, bez skoków. W trakcie mowy tekst się nie cofa, a gdy jest przed celem, zwalnia zamiast stawać.
- **Mowa a cisza.** To, że lektor mówi, wynika z każdego wyniku rozpoznawania ze słowami (także niedopasowanych) oraz z lokalnego detektora głosu: drugi dostęp do mikrofonu przez Web Audio, poziom RMS względem tła dopasowującego się na bieżąco (`src/app/vad.ts`, dźwięk nie opuszcza urządzenia). Przerwa między sesjami rozpoznawania (Chrome restartuje słuchanie) nie jest ciszą. Z detektorem tekst staje ok. 0,35 s po umilknięciu; bez niego (brak dostępu) po 1,2 s bez wyników. Przy wykryciu ciszy zapamiętywane jest miejsce, gdzie lektor zamilkł (z detektorem: cel w tej chwili; bez niego: ostatni wynik ze słowami minus połowa opóźnienia rozpoznawania), i po wznowieniu mowy tekst liczy od niego, a spóźnione wyniki sprzed przerwy go nie cofają. Tekst wraca (łagodnie, po 2,5 s ciszy) tylko wtedy, gdy wyprzedził to miejsce o więcej niż 2 słowa. Wszystkie progi są heurystyczne [H].
- **Diagnostyka** (ustawienie „Diagnostyka głosu”): w czasie czytania w rogu widać ostatnie usłyszane słowa, dopasowanie, tryb (za głosem, z tempa, cisza, powrót), tempo, czas od dopasowania i od mowy, poziom detektora oraz pozycję tekstu i celu. Przycisk „Zapisz log” pobiera plik JSON (`prompter-glos-<data>.json`) z wynikami rozpoznawania, dopasowaniami, zmianami detektora i pozycją tekstu co 250 ms; plik zawiera tekst skryptu i rozpoznane słowa.
- **Symulacja** (`test/sim/pipeline.ts`, `test/voice-sim.test.ts`): cała ścieżka (wyniki z błędami rozpoznawania, ucięte słowa pośrednie, restarty sesji, przerwa lektora) na kilku ziarnach losowych; testy pilnują braku cofania w trakcie mowy, kroku na klatkę i liczby zatrzymań.

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
| `src/core/` | Rdzeń bez DOM: tokenizer, ORP, harmonogram, zegar, nawigacja, przewijanie (sekcja 6 dokumentu), układ przy kamerze, dopasowanie mowy do tekstu |
| `src/app/` | Edytor, odtwarzacz, renderery trybów A i B, ustawienia, magazyn tekstów, klawisze i pilot, kopia biblioteki, nagrywanie wideo, adapter rozpoznawania mowy |
| `public/` | Manifest PWA, ikony (SVG i PNG), Service Worker |
| `test/` | Testy jednostkowe (vitest) |
