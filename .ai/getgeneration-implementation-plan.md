# API Endpoint Implementation Plan: GET /api/v1/stats/generation

## 1. Przegląd punktu końcowego
Endpoint udostępnia zagregowane statystyki sesji generowania dla zalogowanego użytkownika: sumę wygenerowanych propozycji, sumę zaakceptowanych fiszek oraz liczbę sesji. Dane pochodzą z tabeli `generation_sessions` i realizują wymaganie FR6 (metryki generated vs accepted).

Cel biznesowy:
- dostarczenie szybkiego podglądu efektywności pracy użytkownika z generowaniem AI,
- zasilenie widoków dashboard/statystyk bez konieczności pobierania pełnej historii sesji.

Kontrakt statusów wg specyfikacji endpointu:
- `200` dla poprawnego odczytu,
- `401` dla braku autoryzacji,
- `500` dla błędu serwera.

## 2. Szczegóły żądania
- Metoda HTTP: `GET`
- Struktura URL: `/api/v1/stats/generation`
- Uwierzytelnianie: wymagane (sesja/JWT Supabase)
- Parametry:
  - Wymagane: brak
  - Opcjonalne: brak (spec nie definiuje query/body; ewentualne rozszerzenia breakdown dopiero w kolejnych iteracjach)
- Request Body: brak

Walidacja wejścia:
- walidacja autoryzacji użytkownika na początku handlera (guard clause),
- brak walidacji query/body, ponieważ endpoint ich nie przyjmuje,
- dla spójności projektu walidacja schematem Zod może być użyta dla pustego kontraktu requestu (opcjonalnie), ale kluczowa jest walidacja `user` z auth.

Niezbędne typy DTO i modele:
- istniejące DTO (`src/types.ts`):
  - `GenerationStatsDto`
  - `GetGenerationStatsResponseDto`
- zalecane modele serwisowe (wewnętrzne, camelCase):
  - `GetGenerationStatsInput` `{ userId: string }`
  - `GetGenerationStatsResult` `{ totalGenerated: number; totalAccepted: number; sessionCount: number }`
- command model:
  - endpoint jest odczytowy (`GET`), więc nie wymaga command modelu mutującego; `GetGenerationStatsInput` pełni rolę wejścia aplikacyjnego do serwisu.

## 3. Szczegóły odpowiedzi
### 200 OK
Kształt odpowiedzi:
- `data.total_generated` - `SUM(generated_count)` dla sesji użytkownika,
- `data.total_accepted` - `SUM(accepted_count)` dla sesji użytkownika,
- `data.session_count` - liczba sesji użytkownika.

Przykład:
```json
{
  "data": {
    "total_generated": 240,
    "total_accepted": 180,
    "session_count": 42
  }
}
```

Semantyka danych:
- gdy użytkownik nie ma sesji, endpoint nadal zwraca `200` z wartościami `0`,
- wartości muszą być zwrócone jako liczby całkowite (bez `null`).

Mapowanie statusów (w tym standard projektowy):
- `200` - poprawny odczyt statystyk,
- `400` - nie dotyczy aktualnego kontraktu (brak danych wejściowych poza auth),
- `401` - brak aktywnej sesji użytkownika,
- `404` - nie dotyczy agregatu globalnego użytkownika,
- `500` - błąd nieoczekiwany/Supabase.

## 4. Przepływ danych
1. Handler `GET` w `src/pages/api/v1/stats/generation.ts` odbiera żądanie (`export const prerender = false`).
2. Handler pobiera klienta z `context.locals.supabase` (zgodnie z regułami backend) i odczytuje użytkownika z sesji.
3. Gdy brak użytkownika, następuje szybki zwrot `401`.
4. Handler deleguje logikę do serwisu, np. `generationStatsService.getForUser({ userId })`.
5. Serwis wykonuje agregację na `generation_sessions` filtrowaną po użytkowniku:
   - `SUM(generated_count)` jako `total_generated`,
   - `SUM(accepted_count)` jako `total_accepted`,
   - `COUNT(*)` jako `session_count`.
6. Serwis normalizuje wynik (`null` -> `0`) i mapuje do `GenerationStatsDto`.
7. Handler zwraca `200` z `GetGenerationStatsResponseDto`.

Ekstrakcja logiki do service:
- utworzyć nowy serwis `src/lib/services/generation-stats.service.ts` albo dodać metodę do istniejącego serwisu sesji,
- rekomendacja: nowy serwis dla czytelnego SRP (statystyki jako osobny use case),
- route pozostaje cienkim adapterem HTTP (auth, wywołanie serwisu, mapowanie błędów).

## 5. Względy bezpieczeństwa
- Uwierzytelnianie:
  - endpoint dostępny wyłącznie dla zalogowanych użytkowników (`401` przy braku sesji).
- Autoryzacja i izolacja danych:
  - RLS na `generation_sessions` (`user_id = auth.uid()`),
  - dodatkowy jawny filtr po `user_id` w zapytaniu agregującym dla obrony warstwowej.
- Ograniczenie wycieku informacji:
  - brak zwracania `user_id` i szczegółów pojedynczych sesji,
  - odpowiedzi błędów nie ujawniają SQL ani stack trace.
- Ochrona operacyjna:
  - brak wejścia od użytkownika poza tokenem zmniejsza powierzchnię ataku,
  - logowanie bezpieczeństwa powinno pomijać dane wrażliwe i tokeny.

## 6. Obsługa błędów
Scenariusze błędów i statusy:
- `401 Unauthorized`
  - brak sesji lub nieprawidłowy token,
  - brak możliwości ustalenia `userId` z kontekstu.
- `500 Internal Server Error`
  - błąd klienta Supabase,
  - błąd połączenia z bazą,
  - nieobsłużony wyjątek runtime.

Rejestrowanie błędów:
- w aktualnym schemacie brak dedykowanej tabeli błędów, więc nie zapisujemy błędów do DB,
- stosować logowanie aplikacyjne (np. logger/Sentry) z polami:
  - `requestId`, `endpoint`, `method`, `userId` (jeśli dostępne), `statusCode`, `errorCode`, `durationMs`,
- logowanie nie może blokować odpowiedzi API i nie może ujawniać sekretów.

Zasady implementacyjne:
- guard clauses i early return dla `401`,
- happy path po walidacji/autoryzacji,
- spójne, przyjazne komunikaty błędów dla klienta.

## 7. Wydajność
- Zapytanie agregujące działa na `generation_sessions` z filtrem po `user_id`; należy wykorzystać indeks `generation_sessions_user_id_idx`.
- Wykonać pojedyncze zapytanie agregujące zamiast wielu odczytów (minimalizacja round-trip).
- Upewnić się, że agregaty nie skanują danych innych użytkowników (RLS + filtr), co ogranicza koszt.
- Przy braku danych mapować `null` na `0` po stronie serwisu bez dodatkowych zapytań.
- Dodać pomiar czasu wykonania endpointu (`durationMs`) do logów technicznych dla monitoringu.

## 8. Kroki implementacji
1. Utworzyć endpoint `src/pages/api/v1/stats/generation.ts` z `export const prerender = false` i handlerem `GET`.
2. Dodać w route warstwę auth opartą o `context.locals.supabase`; brak użytkownika mapować na `401`.
3. Utworzyć `src/lib/services/generation-stats.service.ts` z metodą `getForUser(input)`.
4. W serwisie zaimplementować zapytanie agregujące do `generation_sessions` (`SUM` + `COUNT`) z filtrem `user_id`.
5. Znormalizować wynik agregacji (`null` -> `0`) i zmapować do `GenerationStatsDto`.
6. W route zwracać `GetGenerationStatsResponseDto` z kodem `200`.
7. Ujednolicić mapowanie błędów serwera na `500` oraz bezpieczne logowanie kontekstu technicznego.
8. Zweryfikować zgodność z regułami projektu:
   - użycie `context.locals.supabase`,
   - logika domenowa w `src/lib/services`,
   - styl guard clauses / early returns.
