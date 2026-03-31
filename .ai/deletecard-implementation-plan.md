# API Endpoint Implementation Plan: Delete Card (`DELETE /api/v1/cards/:cardId`)

## 1. Przegląd punktu końcowego
Endpoint usuwa trwale pojedynczą fiszkę użytkownika z tabeli `cards` (bez soft delete), zgodnie z wymaganiem US-006. Operacja jest dostępna tylko dla użytkownika uwierzytelnionego i ma zwracać pustą odpowiedź `204 No Content` po sukcesie.

Zakres endpointu:
- Usunięcie 1 rekordu z `cards` po `id`.
- Brak request body i brak payloadu w odpowiedzi sukcesu.
- Wymagana autoryzacja Supabase Auth + egzekwowanie własności rekordu przez RLS.
- Jednolity `404` dla „nie istnieje” oraz „nie należy do użytkownika”.

## 2. Szczegóły żądania
- Metoda HTTP: `DELETE`
- Struktura URL: `/api/v1/cards/:cardId`
- Parametry:
  - Wymagane:
    - `cardId` (path, `uuid`) - identyfikator karty do trwałego usunięcia.
  - Opcjonalne: brak.
- Request Body: brak.
- Nagłówki:
  - `Authorization: Bearer <access_token>` (lub aktywna sesja cookie Supabase).

Walidacja wejścia:
- Walidacja `cardId` przez Zod: `z.string().uuid()`.
- Niepoprawny `cardId` -> `400 Bad Request`.
- Jeżeli pojawi się nieoczekiwane body, endpoint je ignoruje (brak kontraktu na body dla `DELETE`).

Wykorzystywane typy DTO i modele:
- Istniejące typy:
  - `CardEntity`, `CardDto` (do ewentualnego wewnętrznego mapowania wyniku istnienia rekordu).
- Typy w `src/types.ts` (aktualny stan):
  - `DeleteCardPathParamsDto`: `{ cardId: string }`.
  - `DeleteCardInput` (service-level): `{ cardId: string; userId: string }`.
  - `DeleteCardCommand` (alias legacy): wskazuje na `DeleteCardInput`.
- Odpowiedź sukcesu:
  - Brak dedykowanego DTO body (status `204` z pustym ciałem).

## 3. Szczegóły odpowiedzi
### 3.1 Sukces
- Status: `204 No Content`
- Body: puste.

### 3.2 Błędy
- `400 Bad Request` - niepoprawny format `cardId` (nie-UUID).
- `401 Unauthorized` - brak uwierzytelnienia.
- `404 Not Found` - rekord nie istnieje albo nie należy do użytkownika.
- `500 Internal Server Error` - błąd serwera/Supabase.

Rekomendowany format błędu (spójny z pozostałymi endpointami):
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Card not found."
  }
}
```

## 4. Przepływ danych
1. Handler `DELETE` w `src/pages/api/v1/cards/[cardId].ts` odbiera żądanie.
2. Handler pobiera klienta Supabase z `context.locals` (zgodnie z regułami backend).
3. Walidacja sesji:
   - brak użytkownika -> natychmiast `401`.
4. Walidacja parametru ścieżki:
   - niepoprawny UUID -> `400`.
5. Wywołanie warstwy serwisowej (np. `cards.service.ts`) z `DeleteCardInput`.
6. Serwis wykonuje usunięcie:
   - `from("cards").delete().eq("id", cardId).select("id").maybeSingle()` lub równoważny mechanizm potwierdzenia usunięcia.
   - RLS ogranicza operację wyłącznie do rekordów właściciela (`user_id = auth.uid()`).
7. Mapowanie wyniku:
   - brak usuniętego rekordu -> `404`.
   - usunięto 1 rekord -> `204`.
8. Błędy nieoczekiwane są logowane i mapowane na `500`.

Ekstrakcja logiki do service:
- Endpoint: tylko auth, walidacja wejścia, mapowanie kodów HTTP.
- Serwis: operacja DB, interpretacja rezultatów Supabase, zwrot typu domenowego (np. `deleted: boolean`).
- Jeśli istnieje `cards.service.ts`, rozszerzyć go o `deleteCard(input)`. Jeśli nie istnieje, utworzyć nowy serwis w `src/lib/services/cards.service.ts`.

## 5. Względy bezpieczeństwa
- Uwierzytelnianie: endpoint wyłącznie dla zalogowanych użytkowników (`401` dla braku sesji).
- Autoryzacja: RLS na `cards` z polityką `DELETE user_id = auth.uid()`.
- Ochrona przed ID enumeration: ten sam `404` dla obcego i nieistniejącego `cardId`.
- Walidacja wejścia: restrykcyjny UUID parser (Zod) redukujący błędy i probing.
- Minimalizacja wycieku danych: brak zwracania danych karty po usunięciu (`204`).
- Bezpieczne logowanie: bez tokenów, bez pełnych danych użytkownika, z `requestId`.

## 6. Obsługa błędów
Scenariusze błędów i statusy:
- Brak sesji użytkownika -> `401`.
- `cardId` niezgodny z UUID -> `400`.
- Nie znaleziono rekordu do usunięcia (lub rekord poza RLS) -> `404`.
- Błąd połączenia z DB / timeout / nieoczekiwany błąd Supabase -> `500`.
- Niezłapany wyjątek w kodzie endpointu/serwisu -> `500`.

Rejestrowanie błędów:
- `db-plan.md` nie definiuje tabeli błędów, więc logowanie realizować aplikacyjnie (logger serwera).
- Minimalny kontekst logu: `endpoint`, `method`, `userId` (jeśli dostępny), `cardId`, `requestId`, `errorCode`.
- Dla `500` logować szczegóły techniczne po stronie serwera, klientowi zwracać komunikat ogólny.
- Dla `400/401/404` logowanie na poziomie `info/warn` (bez stack trace, o ile niepotrzebny).

## 7. Wydajność
- Operacja `DELETE` po `id` (PK UUID) jest szybka i skalowalna.
- Brak potrzeby paginacji, cache ani joinów.
- Utrzymać pojedynczy round-trip do DB (usuń + potwierdź wynik w jednym zapytaniu).
- RLS dokłada niewielki narzut, akceptowalny dla operacji jednostkowej.
- Warto monitorować metryki: latencja p95, odsetek `404`, odsetek `500`.

## 8. Kroki implementacji
1. Utworzyć/uzupełnić plik endpointu `src/pages/api/v1/cards/[cardId].ts`:
   - `export const prerender = false`
   - handler `DELETE`.
2. Dodać schemat Zod walidujący `cardId` jako UUID.
3. Dodać guard uwierzytelnienia (Supabase user z `context.locals`) i zwrot `401`.
4. W `src/types.ts` użyć istniejących: `DeleteCardPathParamsDto`, `DeleteCardInput` (oraz legacy alias `DeleteCardCommand`).
5. Utworzyć lub rozszerzyć `src/lib/services/cards.service.ts` o metodę `deleteCard(input)`.
6. W serwisie zaimplementować usuwanie rekordu z `cards` z interpretacją:
   - usunięto rekord -> sukces
   - nie usunięto rekordu -> wynik domenowy „not found”.
7. W handlerze zmapować wyniki serwisu na statusy:
   - `204` sukces,
   - `404` not found/not owned,
   - `500` błędy infrastrukturalne.
8. Dodać bezpieczne logowanie błędów serwerowych z kontekstem requestu.
9. Upewnić się, że odpowiedź sukcesu nie zawiera body (`return new Response(null, { status: 204 })`).
