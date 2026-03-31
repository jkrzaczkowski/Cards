# API Endpoint Implementation Plan: GET /api/v1/cards

## 1. Przegląd punktu końcowego
Endpoint udostępnia listę fiszek zalogowanego użytkownika (widok „Moje fiszki”) z paginacją i sortowaniem.  
Zwraca dane w formacie `ListCardsResponseDto` (`data` + `meta`) i wspiera dwa tryby paginacji: offset (`page`, `limit`) oraz cursor (`cursor`), z jasno zdefiniowanym priorytetem `cursor` nad `page`.

## 2. Szczegóły żądania
- Metoda HTTP: `GET`
- Struktura URL: `/api/v1/cards`
- Uwierzytelnienie: wymagane (sesja/JWT Supabase)
- Request Body: brak
- Parametry query:
  - Wymagane: brak
  - Opcjonalne:
    - `page` (integer, domyślnie `1`, min `1`)
    - `limit` (integer, domyślnie `20`, min `1`, max `100`)
    - `sort` (`created_at_desc` | `created_at_asc` | `updated_at_desc`, domyślnie `created_at_desc`)
    - `cursor` (string; UUID ostatniego elementu z poprzedniej strony lub token kursora)
- Reguły interpretacji:
  - Jeśli przekazano `cursor`, endpoint działa w trybie cursor-based (ignoruje `page`).
  - Jeśli `cursor` nie został przekazany, endpoint działa w trybie page-based.
  - Niepoprawny format/zakres query -> `400`.

## 3. Wykorzystywane typy
- Istniejące typy z `src/types.ts`:
  - `ListCardsQueryDto`
  - `CardDto`
  - `ListCardsResponseDto`
  - `PaginationMetaDto`
  - `CardSource`
- Zalecane typy uzupełniające (wewnętrzne, warstwa backend):
  - `ListCardsQuerySchema` (Zod schema do walidacji i normalizacji query)
  - `ListCardsCommand` (znormalizowany model wejściowy serwisu), np.:
    - `userId: string`
    - `limit: number`
    - `sort: "created_at_desc" | "created_at_asc" | "updated_at_desc"`
    - `mode: "page" | "cursor"`
    - `page?: number`
    - `cursor?: string`
  - `ListCardsResult` (model wewnętrzny przed mapowaniem do `ListCardsResponseDto`)

## 4. Szczegóły odpowiedzi
- `200 OK` (sukces):
  - `data`: tablica fiszek użytkownika (`CardDto[]`)
  - `meta`:
    - `page`: aktualna strona; w cursor-mode utrzymujemy stałe `page=1` dla spójnego kontraktu odpowiedzi
    - `limit`: rozmiar strony
    - `total`: łączna liczba rekordów użytkownika
    - `has_more`: informacja o dostępności kolejnych rekordów
- `400 Bad Request`: nieprawidłowe query (`page`, `limit`, `sort`, `cursor`)
- `401 Unauthorized`: brak aktywnej sesji/JWT
- `404 Not Found`: nie dotyczy tej operacji listowania (pusta lista -> `200`)
- `500 Internal Server Error`: nieoczekiwany błąd aplikacji lub bazy danych

## 5. Przepływ danych
1. **Astro API route** (`src/pages/api/v1/cards.ts` lub analogiczna ścieżka):
   - `export const prerender = false`
   - Handler `GET`
2. **Pobranie kontekstu auth i klienta DB**:
   - użycie `context.locals.supabase` (zgodnie z regułami backend)
   - odczyt użytkownika/sesji i guard na brak autoryzacji (`401`)
3. **Walidacja query przez Zod**:
   - parse + normalizacja wartości domyślnych
   - wybór trybu paginacji (`cursor` vs `page`)
4. **Wywołanie serwisu** (`src/lib/services/cards.service.ts`):
   - metoda np. `listUserCards(command, supabase)`
   - budowa zapytania do tabeli `cards` z filtrem po użytkowniku
   - mapowanie sortowania:
     - `created_at_desc` -> `order("created_at", { ascending: false })`
     - `created_at_asc` -> `order("created_at", { ascending: true })`
     - `updated_at_desc` -> `order("updated_at", { ascending: false })`
   - paginacja:
     - page-mode: `range(from, to)`
     - cursor-mode: filtr względem kursora + `limit + 1` do wyliczenia `has_more`
   - pobranie `total` (np. `count: "exact"`), z oceną kosztu wydajnościowego
5. **Mapowanie encji do DTO**:
   - usunięcie pól wewnętrznych (`user_id`)
   - wymuszenie typu `source` zgodnego z `CardSource`
6. **Budowa odpowiedzi**:
   - `return new Response(JSON.stringify(payload), { status: 200 })`
   - ustawienie `content-type: application/json`

## 6. Względy bezpieczeństwa
- **Uwierzytelnienie**: endpoint tylko dla zalogowanych użytkowników (`401` gdy brak sesji).
- **Autoryzacja danych**:
  - podstawowo przez RLS (`cards.user_id = auth.uid()`),
  - dodatkowo jawny filtr po user id w zapytaniu, aby ograniczyć ryzyko błędnej konfiguracji.
- **Walidacja wejścia**:
  - whitelist `sort`,
  - limity liczbowe dla `page`/`limit`,
  - walidacja formatu `cursor`.
- **Minimalizacja ujawniania informacji**:
  - komunikaty błędów bez szczegółów SQL,
  - brak zwracania `user_id` i danych wrażliwych.
- **Odporność na nadużycia**:
  - twardy cap `limit` (np. 100),
  - możliwość dołożenia throttlingu/rate limiting w middleware.

## 7. Obsługa błędów
- Scenariusze i statusy:
  - `400`: niepoprawne query, np. `limit=0`, `sort=foo`, nieprawidłowy `cursor`.
  - `401`: brak sesji, wygasły token, niepoprawny JWT.
  - `403`: przypadki wyjątkowe polityk dostępu (opcjonalnie zachować mapowanie, choć przy poprawnym RLS rzadkie).
  - `500`: błąd Supabase/DB, wyjątek runtime, błąd mapowania.
- Strategia implementacyjna:
  - guard clauses w handlerze (walidacja i auth na początku),
  - wspólny formatter błędów HTTP (spójny shape odpowiedzi),
  - logowanie błędów z kontekstem (`requestId`, `userId`, parametry query bez danych wrażliwych).
- Rejestracja błędów w tabeli błędów:
  - W dostarczonym modelu DB brak dedykowanej tabeli błędów.
  - Plan MVP: logowanie aplikacyjne (server logs) + adapter `ErrorAuditService` jako punkt rozszerzenia.
  - Jeśli tabela błędów zostanie dodana później (np. `api_errors`), adapter powinien:
    - zapisać `endpoint`, `method`, `userId`, `statusCode`, `errorCode`, `message`, `requestId`, `createdAt`,
    - działać best-effort (błąd logowania nie może przerywać głównej odpowiedzi API).

## 8. Wydajność
- Wykorzystać indeksy:
  - `cards_user_id_idx`
  - `cards_user_id_created_at_idx` (istotny dla domyślnego sortowania).
- Ograniczyć payload:
  - selekcja tylko potrzebnych kolumn (`id`, `front`, `back`, `source`, `created_at`, `updated_at`).
- Ograniczyć koszt paginacji:
  - dla dużych zbiorów preferować cursor-mode,
  - rozważyć optymalizację `total` (np. warunkowe liczenie lub cache), jeśli `count: exact` stanie się bottleneckiem.
- Zapewnić stabilność sortowania:
  - przy równych timestampach dodać tie-breaker po `id` dla deterministycznych stron.

## 9. Kroki implementacji
1. Utworzyć endpoint Astro `GET` dla `/api/v1/cards` z `export const prerender = false`.
2. Dodać schemat Zod dla query (`page`, `limit`, `sort`, `cursor`) wraz z domyślnymi wartościami i capem limitu.
3. Dodać/rozszerzyć serwis `cards.service` o metodę listowania kart użytkownika (`listUserCards`).
4. Zaimplementować mapowanie sortowania i obu trybów paginacji (page/cursor), z priorytetem `cursor`.
5. Zaimplementować mapowanie encji DB do `CardDto` i budowę `ListCardsResponseDto`.
6. Dodać spójny mechanizm obsługi błędów i logowania (z miejscem na przyszły zapis do tabeli błędów).
7. Zweryfikować zgodność z RLS i regułami projektu (użycie `context.locals.supabase`, Zod, separacja logiki do `src/lib/services`).
