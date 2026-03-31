# API Endpoint Implementation Plan: POST `/api/v1/cards` (Create cards bulk)

## 1. Przegląd punktu końcowego
Endpoint służy do masowego utworzenia fiszek użytkownika (1-50 rekordów w jednym żądaniu) na podstawie finalnej treści `front`/`back` dostarczonej przez klienta.  
Każdy element może być:
- kartą manualną (`proposal_id` brak/null -> `source = manual`),
- kartą pochodzącą z propozycji AI (`proposal_id` obecne i poprawne -> `source = ai_generated`).

Wymagania biznesowe:
- pełna atomowość wsadu: jeśli dowolna pozycja jest niepoprawna, endpoint odrzuca cały request (`400`) i nic nie zapisuje,
- dla kart AI endpoint musi potwierdzić własność propozycji (`card_proposals -> generation_sessions.user_id = auth.uid()`),
- po udanym zapisie należy zwiększyć `generation_sessions.accepted_count` dla sesji, z których pochodziły zaakceptowane propozycje.

## 2. Szczegóły żądania
- Metoda HTTP: `POST`
- URL: `/api/v1/cards`
- Uwierzytelnienie: wymagane (Supabase Auth; brak sesji -> `401`)
- Content-Type: `application/json`

Request body:
```json
{
  "cards": [
    {
      "front": "string",
      "back": "string",
      "proposal_id": "uuid | null"
    }
  ]
}
```

Parametry:
- Wymagane:
  - `cards` (array, min 1, max 50),
  - dla każdego elementu: `front` (non-empty, max 200), `back` (non-empty, max 500).
- Opcjonalne:
  - `proposal_id` (UUID lub `null`/brak).

Walidacja wejścia (Zod + reguły DB):
- `cards` musi być tablicą i mieć 1-50 elementów.
- `front` i `back` muszą być stringami po `trim()` o długości > 0.
- limity długości: `front <= 200`, `back <= 500`.
- `proposal_id` jeśli podane: poprawny UUID.
- `source` nie może być przyjmowane z requestu (ignorowane/odrzucane przez schemat).

Rekomendowane typy (DTO/Command):
- W `src/types.ts` (już obecne):
  - `CreateCardItemRequestDto`
  - `CreateCardsRequestDto`
  - `CreateCardsResponseDto`
  - `CreateCardItemInput`
  - `CreateCardsInput`
- Dodać/utrzymać typ wewnętrzny service:
  - `ResolvedCreateCardItemInput = { front: string; back: string; source: "manual" | "ai_generated"; proposalId?: string | null; sessionId?: string }`
  - `CreateCardsServiceResult = CardDto[]`

## 3. Szczegóły odpowiedzi
Sukces:
- `201 Created`
```json
{
  "data": [
    {
      "id": "uuid",
      "front": "string",
      "back": "string",
      "source": "manual | ai_generated",
      "created_at": "ISO-8601",
      "updated_at": "ISO-8601"
    }
  ]
}
```
- kolejność elementów w `data` musi odpowiadać kolejności z `cards[]` w request.

Błędy:
- `400 Bad Request` - walidacja body (array poza zakresem, puste pola, przekroczone limity, zły format UUID),
- `401 Unauthorized` - brak autoryzacji,
- `404 Not Found` - `proposal_id` nie istnieje lub nie należy do zalogowanego użytkownika,
- `500 Internal Server Error` - nieoczekiwany błąd serwera/DB.

Uwagi o kodach statusu:
- dla tego endpointu używamy `201` (create),
- `200` pozostaje dla endpointów odczytu i nie jest zwracane tutaj.

## 4. Przepływ danych
1. **Route handler (Astro API)**  
   Plik: `src/pages/api/v1/cards.ts`  
   Wymagania: `export const prerender = false`, handler `POST`, pobranie klienta Supabase z `context.locals`.

2. **Autoryzacja**  
   Odczyt użytkownika z kontekstu sesji; brak usera -> natychmiast `401`.

3. **Walidacja requestu**  
   Walidacja schematem Zod (body + constraints 1-50, długości, UUID).  
   Błąd walidacji -> `400` z czytelnym komunikatem.

4. **Delegacja do service**  
   Nowy serwis (zalecane): `src/lib/services/cards.service.ts` (lub rozszerzenie istniejącego, jeśli już jest):
   - `createCardsForUser(userId: string, input: CreateCardsInput, supabase: SupabaseClient): Promise<CardDto[]>`

5. **Weryfikacja `proposal_id` (bulk, przed insertem)**  
   - wyciągnąć unikalne `proposal_id` z inputu,
   - jednym zapytaniem pobrać `card_proposals` wraz z `session_id`,
   - zweryfikować własność przez join do `generation_sessions` (`user_id = auth.uid()`),
   - jeśli liczba zwróconych propozycji < liczby wejściowych `proposal_id` -> `404`.

6. **Przygotowanie payloadu do `cards`**  
   Dla każdego elementu:
   - `source = "ai_generated"` jeśli poprawny `proposal_id`,
   - `source = "manual"` gdy `proposal_id` brak/null,
   - dopisać `user_id = auth.uid()`.

7. **Insert do `cards` (batch)**  
   - wykonać pojedynczy insert tablicy rekordów,
   - od razu `select` pól odpowiedzi (`id`, `front`, `back`, `source`, `created_at`, `updated_at`).

8. **Aktualizacja liczników `accepted_count`**  
   - zgrupować zaakceptowane propozycje po `session_id`,
   - zaktualizować `generation_sessions.accepted_count += n` na sesję,
   - preferowane: RPC SQL function do atomowego inkrementu wielu sesji; alternatywnie seria update w transakcji.

9. **Zwrot odpowiedzi**  
   - mapowanie do `CreateCardsResponseDto`,
   - status `201`.

10. **Obsługa atomowości**  
   Krytyczne: insert kart + inkrementacja liczników powinny być atomowe.  
   Rekomendacja implementacyjna:
   - jedna funkcja RPC w PostgreSQL wykonująca pełny przepływ w transakcji,

## 5. Względy bezpieczeństwa
- **AuthN/AuthZ**: endpoint tylko dla zalogowanych (`401` dla anonimowych).
- **RLS**: opierać się na politykach tabel (`cards`, `generation_sessions`, `card_proposals`) i dodatkowo robić jawne sprawdzenie własności `proposal_id` na poziomie aplikacji.
- **Mass assignment**: nie przyjmować `source`, `user_id`, `created_at`, `updated_at` z klienta.
- **Input hardening**: limity ilości elementów (max 50) i długości tekstu (200/500) chronią przed nadużyciami i nadmiernym payloadem.
- **Bezpieczne komunikaty błędów**: nie ujawniać szczegółów DB i zapytań.
- **Rate limiting (opcjonalnie middleware)**: chronić endpoint przed spamem tworzenia kart.
- **Idempotency (opcjonalnie przyszłościowo)**: przy słabym łączu rozważyć `Idempotency-Key` aby uniknąć duplikatów przy retrach.

## 6. Obsługa błędów
Scenariusze i mapowanie:
- `400`:
  - brak/niepoprawny JSON,
  - `cards` nie jest tablicą, jest puste lub ma > 50 elementów,
  - `front`/`back` puste albo przekraczają limity,
  - niepoprawny format `proposal_id`.
- `401`:
  - brak aktywnej sesji użytkownika.
- `404`:
  - co najmniej jeden `proposal_id` nie istnieje albo nie należy do usera.
- `500`:
  - błąd insertu/aktualizacji, błąd RPC, nieobsłużony wyjątek.

Strategia logowania:
- W dostarczonych zasobach brak dedykowanej tabeli błędów - logowanie do tabeli błędów **nie dotyczy** na ten moment.
- Wdrożyć logowanie aplikacyjne (np. `console.error` + logger) z kontekstem:
  - `endpoint`, `userId`, liczba kart, liczba `proposal_id`, correlation/request id.
- Nie logować pełnej treści `front`/`back` w produkcji (ochrona danych użytkownika).

## 7. Wydajność
- Jedna walidacja Zod dla całego payloadu, nie wiele niezależnych parserów.
- Jedno zapytanie do weryfikacji wszystkich `proposal_id` (unikamy N+1).
- Jeden batch insert do `cards` zamiast insertów per rekord.
- Grupowanie `session_id` i inkrementacja liczników per sesja.
- Wykorzystanie indeksów z planu DB:
  - `card_proposals_session_id_idx`,
  - `generation_sessions_user_id_idx`,
  - `cards_user_id_idx` (i ewentualnie `cards_user_id_created_at_idx` dla późniejszych odczytów).
- Trzymać limit 50 (zgodnie ze specyfikacją) jako główny bezpiecznik wydajności.

## 8. Kroki implementacji
1. **Route API**
   - utworzyć/uzupełnić `src/pages/api/v1/cards.ts`,
   - dodać `export const prerender = false`,
   - zaimplementować `POST` i pobieranie `supabase` z `context.locals`.

2. **Walidacja Zod**
   - utworzyć schematy w `src/lib/validation/cards.schemas.ts` (lub analogicznym module),
   - schema requestu: `cards[1..50]`, `front`, `back`, `proposal_id?`.

3. **Service layer**
   - utworzyć/rozszerzyć `src/lib/services/cards.service.ts`,
   - przenieść całą logikę biznesową z route do serwisu,
   - zastosować guard clauses i wczesne returny.

4. **Typy**
   - użyć istniejących typów z `src/types.ts` (`CreateCardsRequestDto`, `CreateCardsInput`, `CreateCardsResponseDto`),
   - w razie potrzeby dodać pomocnicze typy wewnętrzne (resolved input/result).

5. **Weryfikacja propozycji AI**
   - pobrać i zweryfikować wszystkie `proposal_id` powiązane z `generation_sessions.user_id = auth.uid()`,
   - przy braku zgodności zwrócić `404`.

6. **Persistencja i atomowość**
   - zaimplementować batch insert do `cards`,
   - zaimplementować inkrementację `generation_sessions.accepted_count`,
   - zapewnić atomowość operacji (preferowane RPC SQL function).

7. **Mapowanie odpowiedzi**
   - zwrócić `201` i `data: CardDto[]` w kolejności wejściowej.

8. **Błędy i logowanie**
   - standaryzować mapowanie błędów na `400/401/404/500`,
   - dodać bezpieczne logi techniczne bez ujawniania danych wrażliwych.