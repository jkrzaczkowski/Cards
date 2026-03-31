# API Endpoint Implementation Plan: Update Card (`PATCH /api/v1/cards/:cardId`)

## 1. Przegląd punktu końcowego
Endpoint służy do częściowej aktualizacji istniejącej fiszki użytkownika (`front` i/lub `back`).  
Modyfikacja dotyczy wyłącznie kart należących do aktualnie uwierzytelnionego użytkownika; brak dostępu do cudzych zasobów jest egzekwowany przez RLS oraz warunek `eq("id", cardId)` w zapytaniu aktualizującym.  
Pole `updated_at` nie jest ustawiane ręcznie w aplikacji - aktualizuje je trigger PostgreSQL `BEFORE UPDATE`.

## 2. Szczegóły żądania
- Metoda HTTP: `PATCH`
- Struktura URL: `/api/v1/cards/:cardId`
- Nagłówki:
  - `Authorization`/sesja Supabase (wymagane)
  - `Content-Type: application/json` (wymagane)
- Parametry:
  - Wymagane:
    - `cardId` (parametr ścieżki, UUID)
  - Opcjonalne (w body):
    - `front` (string, max 200 znaków)
    - `back` (string, max 500 znaków)
- Request Body (partial update):

```json
{
  "front": "string",
  "back": "string"
}
```

Zasady walidacji wejścia:
- Co najmniej jedno z pól `front` lub `back` musi być obecne.
- Niedozwolone pola dodatkowe (strict schema).
- Jeśli pole obecne: musi być typu string i spełniać limit długości zgodny z DB (`front <= 200`, `back <= 500`).
- `cardId` musi być poprawnym UUID.

## 3. Wykorzystywane typy
Typy istniejące (`src/types.ts`):
- `UpdateCardCommand` - `Partial<Pick<CardUpdateEntity, "front" | "back">>`.
- `UpdateCardResponseDto` - `ApiDataResponse<CardDto>`.
- `CardDto` - kontrakt odpowiedzi bez `user_id`, z `source: "manual" | "ai_generated"`.

Typy/artefakty do potwierdzenia lub dodania:
- `UpdateCardPathParamsDto` (opcjonalnie lokalny typ) dla `cardId`.
- `updateCardSchema` (Zod) dla body:
  - `front?: z.string().max(200)`
  - `back?: z.string().max(500)`
  - `.refine((v) => v.front !== undefined || v.back !== undefined, ...)`
- `cardIdParamSchema` (Zod) dla UUID w path param.

Mapowanie API vs warstwa serwisowa:
- API przyjmuje snake_case zgodne z kontraktem (`front`, `back` - bez transformacji).
- Serwis przyjmuje `UpdateCardCommand` i `userId`.

## 4. Szczegóły odpowiedzi
### Sukces
- Kod: `200 OK`
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

### Błędy
- `400 Bad Request` - błędny UUID, niepoprawny JSON, puste body, naruszenie limitów długości.
- `401 Unauthorized` - brak sesji / nieprawidłowy użytkownik.
- `404 Not Found` - karta nie istnieje lub nie należy do użytkownika (bez ujawniania, który przypadek zaszedł).
- `500 Internal Server Error` - nieoczekiwany błąd serwera lub bazy.

## 5. Przepływ danych
1. Handler Astro w `src/pages/api/v1/cards/[cardId].ts` odbiera `PATCH` (`export const prerender = false`).
2. Pobranie klienta Supabase z `context.locals.supabase` (zgodnie z regułą backend).
3. Weryfikacja uwierzytelnienia:
   - odczyt użytkownika z sesji;
   - brak użytkownika -> `401`.
4. Walidacja wejścia:
   - walidacja `cardId` (UUID),
   - parsowanie JSON body,
   - walidacja Zod dla partial update + guard "minimum one field".
5. Wywołanie serwisu (istniejącego lub nowego) np. `cards.service.ts`:
   - metoda: `updateCardById({ userId, cardId, patch })`.
6. Serwis wykonuje zapytanie:
   - `update(patch).eq("id", cardId).select(...).single()`
   - RLS ogranicza rekordy do `auth.uid()`.
7. Interpretacja wyniku:
   - brak rekordu -> `404`,
   - sukces -> mapowanie do `CardDto`, zwrot `200`.
8. W przypadku wyjątku: logowanie błędu i `500`.

## 6. Względy bezpieczeństwa
- Uwierzytelnianie obowiązkowe (Supabase Auth) dla całego endpointu.
- Autoryzacja własności zasobu:
  - RLS w tabeli `cards` (`user_id = auth.uid()` dla UPDATE/SELECT),
  - brak ekspozycji informacji, czy `cardId` istnieje globalnie (zawsze `404` dla "not owned / not found").
- Walidacja i sanityzacja wejścia:
  - UUID path param,
  - ścisły schemat body, brak nadmiarowych pól,
  - limity długości zgodne z CHECK w PostgreSQL.
- Ograniczenie powierzchni ataku:
  - tylko pola `front` i `back` są aktualizowalne,
  - brak możliwości nadpisania `source`, `user_id`, `created_at`, `updated_at`.
- Ochrona przed wyciekiem informacji:
  - jednolite komunikaty błędów biznesowych dla `404`,
  - logi techniczne tylko po stronie serwera.

## 7. Obsługa błędów
Macierz błędów i mapowanie statusów:
- `400`
  - niepoprawny `cardId` (nie-UUID),
  - body nie jest JSON,
  - body bez `front` i `back`,
  - przekroczony limit długości.
- `401`
  - brak aktywnej sesji,
  - nieudane pobranie użytkownika z kontekstu auth.
- `404`
  - karta o `cardId` nie istnieje w zakresie użytkownika,
  - karta istnieje, ale nie należy do użytkownika.
- `500`
  - wyjątek w warstwie serwisu/DB,
  - nieobsłużony błąd runtime.

Logowanie błędów:
- Jeżeli projekt posiada tabelę błędów/audytu, zapisywać co najmniej:
  - `endpoint`, `method`, `userId` (jeśli znane), `cardId`, `statusCode`, `errorCode`, `message`, `createdAt`.
- Jeżeli brak dedykowanej tabeli (w obecnym planie DB brak takiej tabeli), stosować:
  - `console.error`/logger serwerowy z `requestId`,
  - spójny format logów umożliwiający późniejsze podpięcie tabeli błędów.

## 8. Wydajność
- Operacja dotyczy pojedynczego rekordu po `id` (PK) - niska złożoność i szybkie wykonanie.
- RLS oraz filtr po `id` minimalizują zakres skanowania.
- `select` po `update` zwraca wyłącznie potrzebne kolumny DTO (bez `user_id`) w celu redukcji payloadu.
- Brak dodatkowych joinów i brak potrzeby paginacji.
- Potencjalne wąskie gardło: częste aktualizacje tej samej karty (rzadkie w MVP); obecny model jest wystarczający.

## 9. Kroki implementacji
1. Utworzyć/uzupełnić handler `PATCH` w `src/pages/api/v1/cards/[cardId].ts` (uppercase handler, `prerender = false`).
2. Dodać schematy Zod:
   - `cardIdParamSchema` (UUID),
   - `updateCardSchema` (partial + co najmniej jedno pole + limity długości).
3. Upewnić się, że endpoint używa `context.locals.supabase` (bez bezpośredniego importu klienta).
4. Wyodrębnić logikę DB do `src/lib/services/cards.service.ts`:
   - `updateCardById({ supabase, userId, cardId, patch })`.
5. W serwisie zaimplementować guard clauses:
   - brak `userId` -> błąd autoryzacji,
   - brak pól do update -> błąd walidacji,
   - brak rekordu po update -> not found.
6. Zaimplementować mapowanie błędów serwisu na statusy HTTP (`400/401/404/500`) i jednolity format odpowiedzi błędu.
8. Zweryfikować zgodność kontraktu odpowiedzi z `UpdateCardResponseDto`.
9. (Opcjonalnie) Dodać integrację z centralnym loggerem/tabelą błędów, gdy taka tabela zostanie wprowadzona w schemacie DB.
