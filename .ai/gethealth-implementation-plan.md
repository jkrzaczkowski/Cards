# API Endpoint Implementation Plan: GET `/api/v1/health`

## 1. Przegląd punktu końcowego
Endpoint `GET /api/v1/health` służy do prostego sprawdzenia liveness aplikacji (DigitalOcean health check, CI smoke checks).  
Jest celowo minimalny, nieautoryzowany i nie zwraca żadnych danych wrażliwych.

Zakres MVP:
- potwierdzenie, że warstwa HTTP aplikacji odpowiada;
- brak połączeń do bazy danych i brak wywołań usług zewnętrznych;
- stabilna, przewidywalna odpowiedź `200` z krótkim payloadem.

## 2. Szczegóły żądania
- Metoda HTTP: `GET`
- Struktura URL: `/api/v1/health`
- Uwierzytelnianie: brak (endpoint publiczny/unauthenticated)
- Parametry:
  - Wymagane: brak
  - Opcjonalne: brak
- Request Body: brak (ciało powinno być ignorowane)
- Nagłówki: brak wymaganych nagłówków specyficznych dla endpointu

Walidacja wejścia:
- brak parametrów do walidacji;
- jeśli klient przekaże query/body, endpoint nadal zwraca standardowe `200`, ponieważ nie ma kontraktu wejściowego.

## 3. Wykorzystywane typy
Typy z `src/types.ts`:
- `HealthDto`:
  - `status: "ok"`

Rekomendowane DTO odpowiedzi:
- `ApiDataResponse<HealthDto>` **nie jest wymagane** przez bieżącą specyfikację, ponieważ kontrakt mówi o surowym obiekcie `{ "status": "ok" }`.
- Dla zgodności ze specyfikacją endpointu należy zwracać bezpośrednio:
  - `{ "status": "ok" }`

Command modele:
- brak (endpoint read-only, bez body i bez operacji zapisu).

## 4. Szczegóły odpowiedzi
### Sukces
- `200 OK`
- Body:
```json
{
  "status": "ok"
}
```

### Błędy
Zgodnie z zasadami API (globalne kategorie błędów):
- `500 Internal Server Error` — nieoczekiwany błąd runtime w handlerze.

Uwaga:
- `400`, `401`, `404` nie są oczekiwane dla tego endpointu (brak wejścia i brak autoryzacji), ale pozostają częścią globalnej konwencji API dla innych tras.

## 5. Przepływ danych
Docelowy przepływ:
1. Klient/monitoring wysyła `GET /api/v1/health`.
2. Astro route handler (`src/pages/api/v1/health.ts`) odbiera żądanie.
3. Handler deleguje do lekkiego serwisu health (np. `src/lib/services/health.service.ts`) zwracającego `HealthDto`.
4. Handler zwraca `Response` z kodem `200` i JSON `{ "status": "ok" }`.

Interakcje z infrastrukturą:
- brak odczytów/zapisów do PostgreSQL;
- brak użycia Supabase client;
- brak użycia OpenRouter;
- brak modyfikacji stanu.

## 6. Względy bezpieczeństwa
- Endpoint nie zwraca sekretów, wersji środowiska, stack trace, szczegółów bazy ani statusu usług zależnych.
- Odpowiedź jest stała i mała, co ogranicza powierzchnię ataku.
- Metoda tylko `GET`; inne metody powinny być odrzucane standardowo przez Astro routing (404/405 zależnie od konfiguracji).
- Brak logiki auth eliminuje ryzyko wycieku tokenów lub błędów autoryzacji na tej trasie.
- W przypadku wyjątków należy logować zdarzenie po stronie serwera bez ujawniania detali klientowi.

## 7. Obsługa błędów
Scenariusze i kody:
- **Nieoczekiwany wyjątek w handlerze/serializacji** -> `500`
  - odpowiedź: zunifikowany payload błędu projektu (jeśli istnieje globalny formatter), bez stack trace;
  - logowanie: logger aplikacyjny (`error`), z metadanymi: nazwa endpointu, metoda, request id/timestamp.

Rejestrowanie błędów w tabeli błędów:
- Dla `health` **nie dotyczy** (brak wymogu i brak powiązania z danymi domenowymi).
- Jeśli w projekcie istnieje centralna tabela błędów/audyt, wpisy dla `500` mogą być dodawane przez globalny middleware, nie lokalnie w endpointzie.

## 8. Wydajność
- O(1) czas wykonania, stały payload — endpoint powinien mieć bardzo niski latency.
- Brak połączeń do DB i usług zewnętrznych minimalizuje ryzyko timeoutów.
- Dla health checks z dużą częstotliwością warto:
  - ograniczyć poziom logowania sukcesów (nie spamować logów),
  - utrzymać małą odpowiedź JSON,
  - monitorować p95/p99 i odsetek `5xx`.

## 9. Kroki implementacji
1. Utworzyć endpoint `src/pages/api/v1/health.ts`.
2. Dodać `export const prerender = false`, aby endpoint działał jako server route.
3. Zaimplementować `export const GET` (uppercase, zgodnie z zasadami Astro) zwracający `new Response(JSON.stringify({ status: "ok" }), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } })`.
4. (Rekomendowane) Wyodrębnić lekki serwis `src/lib/services/health.service.ts` z funkcją zwracającą `HealthDto` dla spójności architektonicznej z innymi endpointami.
5. Nie dodawać zależności od `context.locals.supabase` ani DB w tym endpointzie (świadomy brak integracji).
7. Zweryfikować zgodność z kontraktem API z `.ai/api-plan.md` (payload i status).
8. Dodać wpis do dokumentacji endpointów (jeśli projekt prowadzi changelog/API index).

### Kryteria akceptacji
- `GET /api/v1/health` zwraca `200` i dokładnie `{ "status": "ok" }`.
- Endpoint działa bez tokena/autoryzacji.
- Endpoint nie odwołuje się do bazy ani zewnętrznych API.
- W przypadku błędu wewnętrznego klient dostaje `500`, a szczegóły trafiają do logów serwera.
