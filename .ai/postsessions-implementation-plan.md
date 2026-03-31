# API Endpoint Implementation Plan: POST /api/v1/generation/sessions

## 1. Przegląd punktu końcowego

Endpoint `POST /api/v1/generation/sessions` tworzy sesję generowania fiszek AI dla zalogowanego użytkownika.  
Zakres operacji:
- walidacja `input_text` (1000-10000 znaków),
- wywołanie OpenRouter po stronie serwera (bez ujawniania klucza API do klienta),
- zapis 1 rekordu w `generation_sessions` oraz N rekordów w `card_proposals` (max 50),
- zwrot obiektu sesji i listy propozycji w odpowiedzi `201`.

W MVP treść `input_text` nie jest zapisywana w bazie; zapisywana jest tylko długość (`input_length`).

## 2. Szczegóły żądania

- Metoda HTTP: `POST`
- URL: `/api/v1/generation/sessions`
- Autoryzacja: wymagana sesja użytkownika Supabase (`401` dla braku/niepoprawnej sesji)
- Content-Type: `application/json`

Parametry:
- Wymagane:
  - `input_text: string`
- Opcjonalne:
  - brak

Request body:

```json
{
  "input_text": "string"
}
```

Walidacja wejścia (Zod, w route handlerze):
- body musi być poprawnym JSON i zawierać `input_text` typu string,
- `input_text.trim().length` w zakresie `1000..10000`,
- odrzucenie pustych/whitespace-only danych,
- odrzucenie nadmiarowych pól (schema `.strict()`), aby utrzymać kontrakt API.

Niezbędne typy DTO i Command/Input modele:
- istniejące DTO:
  - `CreateGenerationSessionRequestDto`
  - `CreateGenerationSessionResponseDto`
  - `GenerationSessionDto`
  - `CardProposalDto`
  - `GenerationSessionWithProposalsDto`
- istniejące modele wejściowe service:
  - `CreateGenerationSessionInput` (`inputText`)
- do rozważenia (nowe typy wewnętrzne dla warstwy AI/service):
  - `GenerateProposalsInput` (`inputText`, `maxProposals`)
  - `GenerateProposalsResult` (`proposals: Array<{ front: string; back: string }>`).

## 3. Szczegóły odpowiedzi

Sukces:
- `201 Created`

```json
{
  "data": {
    "session": {
      "id": "uuid",
      "input_length": 3500,
      "generated_count": 12,
      "accepted_count": 0,
      "created_at": "ISO-8601"
    },
    "proposals": [
      {
        "id": "uuid",
        "session_id": "uuid",
        "front": "string",
        "back": "string",
        "position": 0,
        "created_at": "ISO-8601"
      }
    ]
  }
}
```

Kody statusu:
- `201` - sesja i propozycje zapisane poprawnie,
- `400` - niepoprawny JSON, brak `input_text`, długość poza zakresem,
- `401` - brak autoryzacji,
- `422` - brak użytecznych propozycji z LLM / błąd parsowania odpowiedzi modelu,
- `429` - limit żądań przekroczony,
- `502` - błąd upstream OpenRouter,
- `503` - timeout / chwilowa niedostępność upstream,
- `500` - nieoczekiwany błąd serwera.

## 4. Przepływ danych

Docelowy przepływ (Astro + Supabase + service layer):
1. Handler `POST` w `src/pages/api/v1/generation/sessions.ts` (z `export const prerender = false`) pobiera `context.locals.supabase`.
2. Guard autoryzacji: pobranie użytkownika z Supabase auth; brak usera => `401`.
3. Parsowanie i walidacja body przez Zod (`CreateGenerationSessionRequestDto` kontraktowo).
4. Wywołanie `generationService.createSession(input)`:
   - 4.1 `openRouterService.generateCardProposals(inputText)` zwraca surową odpowiedź,
   - 4.2 parser/normalizer mapuje wynik do `{ front, back }[]`,
   - 4.3 filtr jakości: usunięcie pustych/niekompletnych pozycji, przycięcie do max 50.
5. Jeśli po walidacji wyników AI brak propozycji => `422`.
6. Transakcja DB (RPC lub sekwencja atomowa po stronie bazy):
   - insert do `generation_sessions` (`user_id`, `input_length`, `generated_count`, `accepted_count=0`),
   - bulk insert do `card_proposals` (`session_id`, `front`, `back`, `position`).
7. Zwrot odpowiedzi `201` z `session` i `proposals` w formacie `CreateGenerationSessionResponseDto`.

Wyodrębnienie logiki do service:
- `src/lib/services/generation.service.ts`
  - orkiestracja use-case endpointu,
  - mapowanie i walidacja biznesowa wyników LLM,
  - warstwa błędów domenowych (`ValidationError`, `UpstreamError`, `NoProposalsError`).
- `src/lib/services/openrouter.service.ts` (lub istniejący klient AI)
  - wyłącznie komunikacja HTTP z OpenRouter, timeouty, retry policy (ostrożnie),
  - mapowanie błędów HTTP/network na błędy techniczne.
- `src/lib/repositories/generation.repository.ts` (opcjonalnie)
  - operacje DB dla `generation_sessions` i `card_proposals`,
  - utrzymanie atomowości zapisu.

## 5. Względy bezpieczeństwa

- Uwierzytelnianie i autoryzacja:
  - endpoint dostępny wyłącznie dla użytkowników `authenticated`,
  - operacje DB wykonują się w kontekście usera; RLS ogranicza dostęp do własnych danych.
- Ochrona sekretów:
  - `OPENROUTER_API_KEY` tylko po stronie serwera (`import.meta.env`), nigdy w kliencie.
- Ochrona przed nadużyciem:
  - rate limiting per user/IP na endpoint generowania (`429`),
  - sensowny timeout na upstream i limit rozmiaru body.
- Bezpieczeństwo danych:
  - brak zapisu pełnego `input_text` do DB minimalizuje ryzyko przetwarzania danych wrażliwych.
- Higiena logowania:
  - nie logować pełnego `input_text` ani surowych payloadów LLM,
  - logować tylko metadane (`userId`, `inputLength`, `requestId`, typ błędu).

## 6. Obsługa błędów

Mapowanie scenariuszy błędów:
- `400 Bad Request`
  - brak body, invalid JSON, brak `input_text`, długość poza `1000..10000`.
- `401 Unauthorized`
  - brak sesji lub token nieważny.
- `422 Unprocessable Entity`
  - odpowiedź LLM nie daje się sparsować do listy fiszek albo po filtracji lista jest pusta.
- `429 Too Many Requests`
  - przekroczenie limitu wywołań endpointu.
- `502 Bad Gateway`
  - OpenRouter zwraca błędy upstream (np. 5xx lub invalid upstream response).
- `503 Service Unavailable`
  - timeout OpenRouter / chwilowa niedostępność usługi.
- `500 Internal Server Error`
  - nieobsłużone wyjątki aplikacji lub błędy zapisu DB.

Rejestrowanie błędów:
- Brak osobnej tabeli błędów w dostarczonym schemacie DB, więc logowanie realizować aplikacyjnie (logger/Sentry).
- Minimalny zestaw pól logu:
  - `requestId`, `userId` (jeśli dostępny), `endpoint`, `statusCode`, `errorCode`, `upstreamStatus`, `durationMs`.
- Jeśli zespół wprowadzi tabelę błędów w przyszłości, dodać async write (best effort) po wygenerowaniu odpowiedzi, bez blokowania requestu.

## 7. Wydajność

- Ograniczyć koszt endpointu:
  - twardy limit wejścia (`10000`) i wyników (`50` propozycji),
  - brak przechowywania pełnego inputu w DB.
- Optymalizacja zapisu:
  - pojedynczy insert sesji + bulk insert propozycji (zamiast N pojedynczych transakcji),
  - rozważyć SQL function/RPC dla pełnej atomowości i mniejszej liczby round-tripów.
- Timeouty i niezawodność:
  - timeout na OpenRouter + kontrolowany retry tylko dla błędów transient (z limitem prób),
  - pomiar czasu etapów (walidacja, LLM, DB) dla profilowania.
- Skalowanie:
  - rate limiting i ewentualna kolejka zadań jako kolejny krok, jeśli ruch wzrośnie.

## 8. Kroki implementacji

1. Dodać/zweryfikować route handler `src/pages/api/v1/generation/sessions.ts`:
   - `export const prerender = false`,
   - metoda `POST`,
   - autoryzacja przez `context.locals.supabase`.
2. Zaimplementować schemat Zod dla requestu (`input_text`) i mapowanie błędów walidacji na `400`.
3. Utworzyć/uzupełnić `openrouter.service.ts`:
   - wywołanie API OpenRouter,
   - timeout, podstawowe retry, mapowanie błędów na domenowe.
4. Utworzyć/uzupełnić `generation.service.ts`:
   - orkiestracja flow endpointu,
   - normalizacja i walidacja odpowiedzi LLM,
   - limit 50 propozycji, `422` dla pustego wyniku.
5. Utworzyć warstwę repository/RPC dla atomowego zapisu:
   - insert do `generation_sessions`,
   - bulk insert do `card_proposals` z `position` od 0,
   - rollback przy błędzie.
6. Dodać mapper odpowiedzi do `CreateGenerationSessionResponseDto` i zwracanie `201`.
7. Dodać middleware/utility rate limit dla endpointu i mapowanie na `429`.
8. Dodać logowanie strukturalne błędów i metryk wykonania bez danych wrażliwych.

