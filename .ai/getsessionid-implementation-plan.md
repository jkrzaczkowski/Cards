# API Endpoint Implementation Plan: GET /api/v1/generation/sessions/:sessionId

<analysis>
1. Klucz specyfikacji: endpoint odczytowy `GET /api/v1/generation/sessions/:sessionId` zwraca pojedynczą sesję generowania wraz z pełną listą propozycji; sukces `200`, błędy `401`, `404`, `500`.
2. Parametry:
   - wymagane: `sessionId` (path, UUID),
   - opcjonalne: brak query params, brak request body.
3. Niezbędne typy:
   - istniejące DTO: `GenerationSessionDto`, `CardProposalDto`, `GenerationSessionWithProposalsDto`, `GetGenerationSessionResponseDto`,
   - nowy model wejścia serwisu: `GetGenerationSessionByIdInput` (`sessionId`, `userId`),
   - opcjonalny model wyniku serwisu: `GetGenerationSessionByIdResult`.
4. Ekstrakcja logiki:
   - cienki handler API w `src/pages/api/v1/generation/sessions/[sessionId].ts`,
   - logika domenowa i zapytania DB w `src/lib/services/generation-sessions.service.ts` (nowa metoda).
5. Walidacja:
   - Zod dla `params.sessionId` jako UUID,
   - auth guard przez `context.locals.supabase`,
   - walidacja kształtu danych wyjściowych (mapowanie do DTO, bez `user_id`).
6. Rejestrowanie błędów:
   - brak dedykowanej tabeli błędów w bieżącym schemacie DB,
   - logowanie aplikacyjne (np. logger/Sentry) z metadanymi technicznymi (`requestId`, `endpoint`, `sessionId`, `userId`, `statusCode`), bez danych wrażliwych.
7. Główne ryzyka bezpieczeństwa:
   - ID enumeration po `sessionId` (mitigacja: `404` dla brak/obcy rekord),
   - brak autoryzacji (mitigacja: `401` i RLS),
   - nadmierne ujawnienie danych (mitigacja: whitelist kolumn i DTO bez `user_id`),
   - wyciek szczegółów błędów SQL (mitigacja: sanitizacja odpowiedzi błędów).
8. Scenariusze błędów:
   - `401` brak sesji użytkownika,
   - `400` niepoprawny format `sessionId` (walidacja wejścia),
   - `404` sesja nie istnieje lub nie jest dostępna (RLS/ownership),
   - `500` nieoczekiwany błąd serwera/bazy.
</analysis>

## 1. Przegląd punktu końcowego
Endpoint udostępnia szczegóły pojedynczej sesji generowania fiszek wraz z wszystkimi powiązanymi propozycjami (`card_proposals`) dla zalogowanego użytkownika. Celem biznesowym jest odtworzenie kontekstu sesji AI (metryki + lista propozycji) po stronie UI bez ujawniania danych innych użytkowników.

Zakres funkcjonalny:
- odczyt 1 rekordu z `generation_sessions`,
- odczyt powiązanych rekordów z `card_proposals` po `session_id`,
- zwrot danych w kontrakcie `GetGenerationSessionResponseDto`,
- utrzymanie zasady „not found or not accessible” jako pojedyncze `404`.

## 2. Szczegóły żądania
- Metoda HTTP: `GET`
- Struktura URL: `/api/v1/generation/sessions/:sessionId`
- Uwierzytelnianie: wymagane (Supabase session/JWT)
- Request Body: brak
- Query params: brak

Parametry:
- Wymagane:
  - `sessionId` (path, UUID)
- Opcjonalne:
  - brak

Walidacja wejścia (zgodnie z regułami projektu):
- walidacja `sessionId` przez Zod (`z.string().uuid()`),
- brak użytkownika w kontekście -> `401`,
- odrzucenie niepoprawnego `sessionId` -> `400`,
- dopuszczalne tylko odczyty sesji należących do bieżącego użytkownika (RLS + filtr logiczny).

## 3. Szczegóły odpowiedzi
### 200 OK
Kontrakt:
- `data.session`: `GenerationSessionDto` (`id`, `input_length`, `generated_count`, `accepted_count`, `created_at`)
- `data.proposals`: `CardProposalDto[]` (`id`, `session_id`, `front`, `back`, `position`, `created_at`)

Przykład:
```json
{
  "data": {
    "session": {
      "id": "uuid",
      "input_length": 3500,
      "generated_count": 12,
      "accepted_count": 3,
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

Statusy dla tego endpointu:
- `200` - poprawny odczyt sesji i propozycji,
- `400` - niepoprawny format `sessionId`,
- `401` - brak autoryzacji,
- `404` - sesja nie istnieje lub jest niedostępna,
- `500` - błąd serwera.

## 4. Przepływ danych
1. Żądanie trafia do handlera `GET` w `src/pages/api/v1/generation/sessions/[sessionId].ts` (`export const prerender = false`).
2. Handler pobiera klienta Supabase z `context.locals.supabase` i odczytuje użytkownika z sesji.
3. Gdy brak użytkownika, handler zwraca `401`.
4. Handler parsuje i waliduje `params.sessionId` przez Zod.
5. Handler przekazuje sterowanie do serwisu, np. `generationSessionsService.getById({ sessionId, userId })`.
6. Serwis pobiera sesję z `generation_sessions`:
   - preferowany odczyt po `id = sessionId`,
   - RLS ogranicza rekordy do `auth.uid()`,
   - opcjonalnie defensywny filtr `user_id = userId` (jawny zamiar biznesowy).
7. Jeśli sesja nie istnieje, serwis zwraca wynik typu `not_found`; route mapuje na `404`.
8. Serwis pobiera propozycje z `card_proposals` po `session_id`, sortowanie po `position ASC` (deterministyczna kolejność prezentacji).
9. Serwis mapuje wynik do `GenerationSessionWithProposalsDto` i zwraca do handlera.
10. Handler zwraca `200` i `GetGenerationSessionResponseDto`.

Rekomendowana ekstrakcja logiki:
- `src/lib/services/generation-sessions.service.ts`
  - `getById(input: GetGenerationSessionByIdInput): Promise<GetGenerationSessionByIdResult>`
  - odpowiedzialność: odczyt danych, mapowanie DTO, semantyka `not_found`
- Route jako adapter HTTP:
  - auth + validation + mapowanie błędów do status codes.

## 5. Względy bezpieczeństwa
- **Uwierzytelnianie**: endpoint tylko dla zalogowanych użytkowników (`401` bez aktywnej sesji).
- **Autoryzacja i izolacja danych**:
  - RLS na `generation_sessions` (`user_id = auth.uid()`),
  - RLS na `card_proposals` przez relację do sesji użytkownika,
  - brak możliwości odczytu cudzego `sessionId`.
- **Ochrona przed ID enumeration**:
  - odpowiedź `404` zarówno dla „nie istnieje”, jak i „brak dostępu”.
- **Walidacja wejścia**:
  - rygor UUID dla `sessionId`,
  - szybkie odrzucenie błędnych danych (`400`) przed zapytaniem biznesowym.
- **Minimalizacja danych**:
  - brak `user_id` w DTO odpowiedzi,
  - brak ujawniania surowych błędów SQL/stack trace do klienta.
- **Sekrety i konfiguracja**:
  - użycie `context.locals.supabase` (zgodnie z regułami),
  - brak importu service role do zwykłego odczytu użytkownika.

## 6. Obsługa błędów
Mapowanie scenariuszy:
- `400 Bad Request`
  - niepoprawny format `sessionId` (np. nie-UUID),
  - opcjonalnie brak parametru path (sytuacja skrajna routingu).
- `401 Unauthorized`
  - brak sesji/JWT,
  - nieudane odczytanie użytkownika z kontekstu auth.
- `404 Not Found`
  - sesja nie istnieje,
  - sesja istnieje, ale użytkownik nie ma dostępu (RLS/ownership).
- `500 Internal Server Error`
  - błędy Supabase/API klienta DB,
  - nieobsłużone wyjątki runtime.

Rejestrowanie błędów:
- W obecnym modelu danych brak tabeli błędów aplikacyjnych, więc nie zapisujemy błędów do DB.
- Logowanie techniczne w warstwie backend (logger/Sentry):
  - pola: `requestId`, `endpoint`, `method`, `sessionId`, `userId` (jeśli znane), `statusCode`, `errorCode`, `durationMs`,
  - bez danych wrażliwych (`front`, `back`, tokeny).
- Przy `500` log pełny po stronie serwera, odpowiedź dla klienta generyczna.

## 7. Wydajność
- Wykorzystać indeks `card_proposals_session_id_idx` dla szybkiego pobrania propozycji po `session_id`.
- Odczyt sesji po PK (`generation_sessions.id`) powinien być stałokosztowy.
- Selekcja tylko potrzebnych kolumn (bez `*`) w obu zapytaniach.
- Ograniczyć liczbę round-tripów:
  - jedno zapytanie z relacją/nested select, jeśli czytelność i typowanie pozostają dobre.
- Sortowanie propozycji po `position ASC` zapewnia stabilny rendering i brak dodatkowego sortowania po stronie klienta.

## 8. Kroki implementacji
1. Utworzyć plik endpointu `src/pages/api/v1/generation/sessions/[sessionId].ts` z `export const prerender = false` i handlerem `GET`.
2. Dodać schemat Zod do walidacji `sessionId` (path param) oraz mapowanie błędu walidacji na `400`.
3. Zaimplementować guard autoryzacji oparty o `context.locals.supabase`; brak usera mapować na `401`.
4. Rozszerzyć `src/lib/services/generation-sessions.service.ts` o metodę `getById`.
5. W serwisie zaimplementować:
   - odczyt sesji po `id`,
   - zwrot stanu `not_found` gdy brak rekordu,
   - odczyt propozycji po `session_id` z sortowaniem `position ASC`,
   - mapowanie do `GenerationSessionWithProposalsDto`.
6. W route zmapować wynik serwisu na `GetGenerationSessionResponseDto` i status `200`.
7. Ujednolicić mapowanie błędów (`400`, `401`, `404`, `500`) zgodnie z kontraktem API.
8. Dodać logowanie strukturalne błędów/latencji bez ujawniania danych wrażliwych.
9. Zweryfikować zgodność typów w `src/types.ts`:
   - użyć istniejących `GetGenerationSessionResponseDto`, `GenerationSessionWithProposalsDto`,
   - dodać tylko modele wewnętrzne serwisu, jeśli potrzebne (`GetGenerationSessionByIdInput`).
