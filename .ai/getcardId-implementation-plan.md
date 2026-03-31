# API Endpoint Implementation Plan: Get Card By ID (`GET /api/v1/cards/:cardId`)

## 1. Przegląd punktu końcowego
Endpoint służy do pobrania pojedynczej fiszki po `cardId` wyłącznie dla zalogowanego użytkownika. Zwraca dane karty w formacie `ApiDataResponse<CardDto>`, a przy braku dostępu lub braku rekordu zwraca jednolite `404`, aby nie ujawniać istnienia zasobu innego użytkownika.

Zakres endpointu:
- Odczyt tylko jednego rekordu z tabeli `cards`.
- Brak modyfikacji danych (read-only).
- Wymagana autoryzacja przez Supabase Auth.
- Zgodność z RLS (`cards.user_id = auth.uid()`).

## 2. Szczegóły żądania
- Metoda HTTP: `GET`
- Struktura URL: `/api/v1/cards/:cardId`
- Parametry:
  - Wymagane:
    - `cardId` (path, `uuid`) - identyfikator karty.
  - Opcjonalne: brak.
- Request Body: brak.
- Nagłówki:
  - `Authorization: Bearer <access_token>` (lub sesja cookie Supabase, zależnie od przyjętego flow middleware).

Walidacja wejścia:
- Walidacja `cardId` przez Zod (`z.string().uuid()`).
- Jeśli `cardId` jest niepoprawny składniowo -> `400 Bad Request`.
- Brak ciała żądania; każde nieoczekiwane dane wejściowe ignorować lub logować diagnostycznie bez wpływu na odpowiedź.

Wykorzystywane typy DTO i modele:
- `GetCardByIdResponseDto` (`ApiDataResponse<CardDto>`) jako kontrakt odpowiedzi.
- `CardDto` jako model pola `data`.
- Brak dedykowanego Command Modelu dla `GET` (brak body i brak mutacji); opcjonalnie lokalny typ serwisowy `GetCardByIdInput = { cardId: string; userId: string }` w warstwie serwisowej.

## 3. Szczegóły odpowiedzi
### 3.1 Sukces
- Status: `200 OK`
- Body:

```json
{
  "data": {
    "id": "uuid",
    "front": "string",
    "back": "string",
    "source": "manual | ai_generated",
    "created_at": "ISO-8601",
    "updated_at": "ISO-8601"
  }
}
```

### 3.2 Błędy
- `400 Bad Request` - nieprawidłowy `cardId` (np. nie-UUID).
- `401 Unauthorized` - brak uwierzytelnienia.
- `404 Not Found` - karta nie istnieje lub nie należy do użytkownika.
- `500 Internal Server Error` - nieobsłużony błąd serwera/bazy.

## 4. Przepływ danych
1. Handler `GET` w `src/pages/api/v1/cards/[cardId].ts` odbiera żądanie i pobiera `supabase` z `context.locals`.
2. Handler pobiera kontekst użytkownika (`auth.getUser()` lub user osadzony przez middleware).
3. Guard clause:
   - brak użytkownika -> `401`.
4. Walidacja `cardId` przez Zod:
   - błąd walidacji -> `400`.
5. Wywołanie warstwy serwisowej (np. `src/lib/services/cards.service.ts`):
   - metoda sugerowana: `getCardById({ cardId, userId })`.
6. Serwis wykonuje zapytanie:
   - `from("cards").select("id, front, back, source, created_at, updated_at").eq("id", cardId).single()`
   - RLS filtruje rekordy po użytkowniku.
7. Mapowanie wyniku do `CardDto` (w tym zawężenie `source` do `CardSource`).
8. Jeśli rekord nie istnieje lub nie jest widoczny przez RLS -> `404`.
9. Zwrot `200` z `GetCardByIdResponseDto`.
10. W przypadku błędu nieobsłużonego: log + `500`.

Rekomendowana ekstrakcja logiki:
- Endpoint powinien zawierać tylko: auth, walidację inputu, mapowanie błędów HTTP.
- Logikę dostępu do danych przenieść do serwisu `cards.service` (istniejącego lub nowego) zgodnie z zasadą `Extract logic into services`.
- Utrzymać czysty kontrakt warstwy serwisowej (input/output typowane przez `src/types.ts`).

## 5. Względy bezpieczeństwa
- **Uwierzytelnianie:** endpoint dostępny tylko dla zalogowanych użytkowników Supabase.
- **Autoryzacja:** oparta o RLS na tabeli `cards`; dodatkowo aplikacyjny check `404` zamiast `403`, aby nie ujawniać istnienia obcych rekordów.
- **Walidacja wejścia:** ścisłe sprawdzenie `cardId` jako UUID.
- **Ochrona przed enumeracją ID:** jednolita odpowiedź `404` dla "nie istnieje" i "brak dostępu".
- **Minimalny zakres danych:** selekcja tylko wymaganych kolumn (bez `user_id`).
- **Sekrety:** brak użycia service-role w tym endpointcie; wyłącznie klient użytkownika z kontekstu requestu.
- **Bezpieczeństwo transportu:** HTTPS w środowisku produkcyjnym.

## 6. Obsługa błędów
Scenariusze i mapowanie:
- Brak sesji lub wygasły token -> `401`.
- Niepoprawny format `cardId` -> `400` + komunikat walidacyjny (bez ujawniania szczegółów infrastruktury).
- `single()` zwraca brak rekordu (lub rekord poza RLS) -> `404`.
- Błąd Supabase (sieć, timeout, nieoczekiwany kod) -> `500`.
- Nieobsłużony wyjątek w kodzie -> `500`.

Rejestrowanie błędów:
- `db-plan.md` nie definiuje dedykowanej tabeli błędów; stosować logowanie aplikacyjne (np. logger serwerowy) z kontekstem:
  - `endpoint`, `method`, `userId` (jeśli dostępne), `cardId`, `requestId`, typ błędu.
- Nie logować tokenów ani pełnych danych wrażliwych.
- Dla `500` logować stack trace po stronie serwera; klientowi zwracać bezpieczny, ogólny komunikat.

## 7. Wydajność
- Zapytanie po kluczu głównym `id` (`UUID PRIMARY KEY`) jest operacją O(1) z użyciem indeksu PK.
- Ograniczyć `select` do wymaganych pól dla mniejszego payloadu.
- Brak potrzeby paginacji, cache i złożonych joinów dla tego endpointu.
- RLS dodaje minimalny narzut; akceptowalne dla pojedynczego odczytu.
- Dla observability mierzyć p95/p99 czasu odpowiedzi endpointu.

## 8. Kroki implementacji
1. Utworzyć endpoint `src/pages/api/v1/cards/[cardId].ts` z `export const prerender = false` i handlerem `GET`.
2. Dodać schemat Zod do walidacji parametru ścieżki (`cardId` jako UUID).
3. Upewnić się, że endpoint korzysta z `supabase` z `context.locals` (zgodnie z regułą backendową).
4. Dodać/rozszerzyć serwis `src/lib/services/cards.service.ts` o metodę `getCardById`.
5. W serwisie zaimplementować zapytanie `cards` z `.eq("id", cardId).single()` i mapowaniem do `CardDto`.
6. W handlerze zmapować błędy serwisu na statusy `400/401/404/500` przy użyciu guard clauses i wczesnych returnów.
7. Ujednolicić format odpowiedzi do `GetCardByIdResponseDto`.
8. Dodać logowanie błędów serwerowych (bez danych wrażliwych), z `requestId` i kontekstem endpointu.
9. Zweryfikować zgodność typów z `src/types.ts` .
