# Prompter

Autonomiczny prompter tekstu (PWA, offline, bez backendu). Projekt: [dokument projektowy](https://claude.ai/code/artifact/948bd202-2431-44b1-88ca-c3edb271063d).

## Funkcje (wersja 0.1)

- Edytor z biblioteką tekstów zapisywaną lokalnie (IndexedDB), import .txt, zapamiętanie ostatniej pozycji.
- Tryb A: przewijanie z linią odczytu w stałym miejscu ekranu.
- Tryb B: jedno słowo, litera ORP zawsze w tym samym punkcie; w pauzie pod słowem widać całe zdanie z wyróżnionym bieżącym słowem.
- Prędkość 50–1000 słów/min, zmiana w trakcie bez skoku tekstu, rozbieg po starcie i pauzie, odliczanie.
- Dopasowanie prędkości do zadanego czasu (np. 3:30), z uwzględnieniem rozbiegu.
- Sterowanie: klawiatura, pilot prezentacyjny (PageUp, PageDown, B, kropka, F5), dotyk, przyciski na ekranie.
- Pełny ekran, blokada wygaszania ekranu (Screen Wake Lock), praca offline po pierwszym otwarciu (Service Worker).

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
| `public/` | Manifest PWA, ikona, Service Worker |
| `test/` | Testy jednostkowe rdzenia (vitest) |
