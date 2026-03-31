# API Endpoint Implementation Plan: GET /api/v1/generation/sessions

## 1. Przegląd punktu końcowego
Endpoint udostępnia paginowaną listę sesji generowania fiszek zalogowanego użytkownika (historia i kontekst statystyk).

Zakres funkcjonalny:
- odczyt sesji z tabeli `generation_sessions` wyłącznie dla bieżącego użytkownika,
- obsługa paginacji (`page`, `limit`) i sortowania po `created_at`,
- zwrot danych w kontrakcie `ListGenerationSessionsResponseDto` (`data` + `meta`),
- zwracanie `200` dla sukcesu, także gdy lista jest pusta.

## 2. Szczegóły żądania
- Metoda HTTP: `GET`
- Struktura URL: `/api/v1/generation/sessions`
- Uwierzytelnianie: wymagane (sesja/JWT Supabase), brak autoryzacji -> `401`
- Request Body: brak

Parametry query:
- Wymagane: brak
- Opcjonalne:
  - `page` (integer, domyślnie `1`, min `1`)
  - `limit` (integer, domyślnie `20`, min `1`, cap np. `100`)
  - `sort` (`created_at_desc` | `created_at_asc`, domyślnie `created_at_desc`)

Walidacja wejścia (Zod):
- `page` i `limit` muszą być liczbami całkowitymi dodatnimi,
- `limit` powinien być ograniczony górnym limitem ochronnym (np. 100),
- `sort` musi należeć do dozwolonej listy,
- niepoprawne wartości query -> `400`.

Wykorzystywane typy DTO / modele:
- istniejące (`src/types.ts`):
  - `ListGenerationSessionsQueryDto`
  - `GenerationSessionDto`
  - `ListGenerationSessionsResponseDto`
  - `PaginationMetaDto`
- rekomendowane modele wewnętrzne (serwis):
  - `ListGenerationSessionsCommand` (`userId`, `page`, `limit`, `sort`)
  - `ListGenerationSessionsResult` (`items`, `total`, `hasMore`)

## 3. Szczegóły odpowiedzi
### 200 OK
Struktura odpowiedzi:
- `data`: lista elementów `GenerationSessionDto`
- `meta`:
  - `page`: bieżąca strona
  - `limit`: rozmiar strony
  - `total`: łączna liczba sesji użytkownika
  - `has_more`: czy istnieje kolejna strona

Przykład:
```json
{
  "data": [
    {
      "id": "uuid",
      "input_length": 3500,
      "generated_count": 12,
      "accepted_count": 3,
      "created_at": "ISO-8601"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "has_more": true
  }
}
```

Pozostałe statusy:
- `400 Bad Request` - niepoprawne parametry query,
- `401 Unauthorized` - brak lub nieprawidłowa sesja użytkownika,
- `404 Not Found` - nie dotyczy listowania (pusta lista to `200`),
- `500 Internal Server Error` - błąd nieoczekiwany po stronie serwera/bazy.

## 4. Przepływ danych
1. Handler `GET` w `src/pages/api/v1/generation/sessions.ts` przyjmuje żądanie (`export const prerender = false`).
2. Handler pobiera klienta Supabase z `context.locals.supabase` i weryfikuje sesję/użytkownika:
   - brak użytkownika -> natychmiast `401`.
3. Query params są parsowane i walidowane przez Zod, z normalizacją wartości domyślnych:
   - domyślnie `page=1`, `limit=20`, `sort=created_at_desc`.
4. Route przekazuje znormalizowane wejście do warstwy serwisowej (np. `generationSessionsService.listUserSessions(...)`).
5. Serwis buduje zapytanie do `generation_sessions`:
   - filtr po `user_id`,
   - sortowanie po `created_at`,
   - paginacja offset (`from`, `to`),
   - odczyt `count` dla `total`.
6. Serwis mapuje wynik na `GenerationSessionDto[]` i wylicza `has_more`.
7. Handler zwraca `200` i payload `ListGenerationSessionsResponseDto`.

Ekstrakcja logiki do service:
- `src/lib/services/generation-sessions.service.ts` (nowy lub rozszerzenie istniejącego):
  - walidacja biznesowa parametrów po normalizacji,
  - wykonanie zapytań do Supabase,
  - obliczanie metadanych paginacji.
- API route utrzymuje rolę cienkiego adaptera HTTP (auth, parse query, mapowanie błędów).

## 5. Względy bezpieczeństwa
- **Uwierzytelnianie**: endpoint dostępny tylko dla zalogowanych użytkowników (`401` bez sesji).
- **Autoryzacja**:
  - wymuszana przez RLS (`generation_sessions.user_id = auth.uid()`),
  - zalecany dodatkowy jawny filtr `user_id` w zapytaniu.
- **Walidacja danych wejściowych**:
  - whitelist dla `sort`,
  - limity i zakresy dla `page`/`limit`,
  - odrzucanie wartości niezgodnych z kontraktem.
- **Minimalizacja wycieku informacji**:
  - brak zwracania `user_id`,
  - komunikaty błędów bez szczegółów SQL.
- **Odporność na nadużycia**:
  - cap na `limit`,
  - opcjonalny rate limiting w middleware dla endpointów listujących.

## 6. Obsługa błędów
Scenariusze i mapowanie statusów:
- `400`: nieprawidłowy format lub zakres query (`page`, `limit`, `sort`).
- `401`: brak aktywnej sesji / nieważny token.
- `404`: nie stosować dla pustej listy; zwracać `200` z `data: []`.
- `500`: błąd Supabase lub nieobsłużony wyjątek runtime.

Rejestrowanie błędów:
- W dostarczonym schemacie DB brak dedykowanej tabeli błędów.
- MVP: logowanie aplikacyjne (server logs/Sentry) z kontekstem:
  - `requestId`, `userId` (jeśli dostępny), `endpoint`, `statusCode`, `errorCode`, `durationMs`.
- Logowanie nie może ujawniać danych wrażliwych i nie może blokować odpowiedzi API.

## 7. Wydajność
- Wykorzystać indeks `generation_sessions_user_id_idx` przy filtrowaniu po użytkowniku.
- Ograniczyć rozmiar strony (`limit` cap), aby zapobiec ciężkim zapytaniom.
- Selekcjonować tylko potrzebne kolumny (`id`, `input_length`, `generated_count`, `accepted_count`, `created_at`).
- Rozważyć stabilne sortowanie (`created_at` + tie-breaker `id`) dla deterministycznych wyników paginacji.
- Monitorować koszt `count: exact`; przy wzroście wolumenu rozważyć optymalizację liczenia `total`.

## 8. Kroki implementacji
1. Dodać endpoint `GET` w `src/pages/api/v1/generation/sessions.ts` oraz `export const prerender = false`.
2. Zaimplementować walidację query przez Zod (`page`, `limit`, `sort`) z domyślnymi wartościami i capem.
3. Dodać guard autoryzacji oparty o `context.locals.supabase` i mapowanie braku sesji na `401`.
4. Utworzyć/rozszerzyć serwis `generation-sessions.service` o metodę listowania sesji użytkownika.
5. Zaimplementować zapytanie do `generation_sessions` z filtrem `user_id`, sortowaniem i paginacją offset.
6. Dodać budowę metadanych (`total`, `has_more`) i mapowanie do `ListGenerationSessionsResponseDto`.
7. Ujednolicić obsługę błędów (`400`, `401`, `500`) i logowanie strukturalne bez danych wrażliwych.
8. Zweryfikować zgodność z regułami projektu:
   - użycie `context.locals.supabase`,
   - walidacja przez Zod,
   - logika biznesowa w `src/lib/services`.

