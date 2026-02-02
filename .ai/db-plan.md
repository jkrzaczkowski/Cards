# Schemat bazy danych PostgreSQL – Cards MVP

## 1. Tabele, kolumny, typy i ograniczenia

### 1.1 Tabela `cards`

Zatwierdzone fiszki użytkownika (ręczne lub zaakceptowane z AI). Jedyny identyfikator udostępniany klientowi (URL, API) to `id` (UUID).

| Kolumna        | Typ          | Ograniczenia |
|----------------|--------------|--------------|
| `id`           | UUID         | PRIMARY KEY, DEFAULT gen_random_uuid() |
| `user_id`      | UUID         | NOT NULL, REFERENCES auth.users(id) ON DELETE CASCADE |
| `front`        | TEXT         | NOT NULL, CHECK (char_length(front) <= 200) |
| `back`         | TEXT         | NOT NULL, CHECK (char_length(back) <= 500) |
| `source`       | TEXT         | NOT NULL, CHECK (source IN ('manual', 'ai_generated')) – wartość zawsze ustawiana w INSERT, bez DEFAULT |
| `created_at`   | TIMESTAMPTZ  | NOT NULL DEFAULT now() |
| `updated_at`   | TIMESTAMPTZ  | NOT NULL DEFAULT now() – aktualizowane przez trigger BEFORE UPDATE |

### 1.2 Tabela `generation_sessions`

Jedna sesja = jeden wiersz utworzony po otrzymaniu odpowiedzi z LLM. Zawiera metryki: długość wejścia, liczba wygenerowanych propozycji, liczba zaakceptowanych (aktualizowana przy zapisie fiszek do `cards`).

| Kolumna          | Typ          | Ograniczenia |
|------------------|--------------|--------------|
| `id`             | UUID         | PRIMARY KEY, DEFAULT gen_random_uuid() |
| `user_id`        | UUID         | NOT NULL, REFERENCES auth.users(id) ON DELETE CASCADE |
| `input_length`   | INTEGER      | NOT NULL – długość tekstu wejściowego (znaki) |
| `generated_count`| INTEGER      | NOT NULL – liczba propozycji w tej sesji (np. liczba wierszy w card_proposals) |
| `accepted_count` | INTEGER      | NOT NULL DEFAULT 0 – liczba fiszek z tej sesji zapisanych do cards; aktualizowana przy zapisie |
| `created_at`     | TIMESTAMPTZ  | NOT NULL DEFAULT now() |

W MVP brak kolumny `input_text`; przechowywana jest tylko `input_length`.

### 1.3 Tabela `card_proposals`

Propozycje fiszek przed zatwierdzeniem. Powiązane z sesją generowania; po zatwierdzeniu dane trafiają do `cards`, a propozycje są usuwane lub nieużywane (w MVP brak powiązania `cards.generation_session_id`).

| Kolumna      | Typ          | Ograniczenia |
|--------------|--------------|--------------|
| `id`         | UUID         | PRIMARY KEY, DEFAULT gen_random_uuid() |
| `session_id` | UUID         | NOT NULL, REFERENCES generation_sessions(id) ON DELETE CASCADE |
| `front`      | TEXT         | NOT NULL |
| `back`       | TEXT         | NOT NULL |
| `position`   | INTEGER      | NOT NULL – kolejność w ramach sesji |
| `created_at` | TIMESTAMPTZ  | NOT NULL DEFAULT now() |

Ograniczenie unikalności: **UNIQUE (session_id, position)**.

Limit liczby propozycji na sesję (np. max 50) egzekwowany w aplikacji; w MVP brak CHECK/triggera w DB.

---

## 2. Relacje między tabelami

| Relacja | Typ | Opis |
|---------|-----|------|
| **cards → user** | N:1 | Wiele fiszek należy do jednego użytkownika (po `user_id`). FK: `user_id` → `auth.users(id)` ON DELETE CASCADE. |
| **generation_sessions → user** | N:1 | Wiele sesji należy do jednego użytkownika (po `user_id`). FK: `user_id` → `auth.users(id)` ON DELETE CASCADE. |
| **card_proposals → generation_sessions** | N:1 | Wiele propozycji należy do jednej sesji. FK: `session_id` → `generation_sessions(id)` ON DELETE CASCADE. |

Brak tabeli `profiles` w MVP; użytkownik = wpis w `auth.users`. Brak encji „zestawy” (decks); fiszki powiązane tylko z `user_id`.

---

## 3. Indeksy

| Tabela              | Indeks | Kolumny | Cel |
|---------------------|--------|---------|-----|
| `cards`             | `cards_user_id_idx` | (user_id) | Filtrowanie fiszek użytkownika, RLS. |
| `cards`             | `cards_user_id_created_at_idx` | (user_id, created_at DESC) | Opcjonalny; lista „Moje fiszki” posortowana po dacie. |
| `generation_sessions` | `generation_sessions_user_id_idx` | (user_id) | Lista sesji użytkownika, RLS, agregaty statystyk. |
| `card_proposals`    | `card_proposals_session_id_idx` | (session_id) | Pobieranie propozycji po sesji, CASCADE/join. |

---

## 4. Zasady PostgreSQL (RLS)

Row Level Security (RLS) **włączone** na wszystkich trzech tabelach.

### 4.1 `cards`

- **SELECT**: `user_id = auth.uid()`
- **INSERT**: `user_id = auth.uid()`
- **UPDATE**: `user_id = auth.uid()`
- **DELETE**: `user_id = auth.uid()`

Polityki osobno dla roli `authenticated` (anon nie ma dostępu do danych użytkownika).

### 4.2 `generation_sessions`

- **SELECT**: `user_id = auth.uid()`
- **INSERT**: `user_id = auth.uid()`
- **UPDATE**: `user_id = auth.uid()`
- **DELETE**: `user_id = auth.uid()`

### 4.3 `card_proposals`

Dostęp przez powiązanie z sesją należącą do użytkownika (brak kolumny `user_id` w tabeli):

- **SELECT**: `EXISTS (SELECT 1 FROM generation_sessions gs WHERE gs.id = card_proposals.session_id AND gs.user_id = auth.uid())`
- **INSERT**: jak wyżej (użytkownik może dodawać propozycje tylko do swoich sesji)
- **UPDATE**: jak wyżej
- **DELETE**: jak wyżej

Polityki definiowane per operacja (SELECT, INSERT, UPDATE, DELETE) i per rola (`anon`, `authenticated`) zgodnie z praktykami projektu; dla tabel z danymi użytkownika dostęp ma wyłącznie `authenticated` z warunkiem na `user_id` / join z `generation_sessions`.

---

## 5. Dodatkowe elementy i uwagi

### 5.1 Trigger aktualizacji `cards.updated_at`

- **Zdarzenie**: BEFORE UPDATE ON cards  
- **Akcja**: ustawienie `NEW.updated_at = now()`.  
Zalecane: funkcja w schemacie `public`, np. `set_updated_at()`, wywoływana przez trigger.

### 5.2 Czyszczenie danych po usunięciu użytkownika

Usunięcie użytkownika z `auth.users` automatycznie usuwa powiązane dane dzięki FK z `ON DELETE CASCADE`:
- `cards.user_id` → `auth.users(id)` CASCADE – usunięcie użytkownika usuwa jego fiszki
- `generation_sessions.user_id` → `auth.users(id)` CASCADE – usunięcie użytkownika usuwa jego sesje
- `card_proposals.session_id` → `generation_sessions(id)` CASCADE – usunięcie sesji usuwa powiązane propozycje

Dodatkowy trigger na `auth.users` nie jest wymagany.

### 5.3 Cykl życia danych

- **Sesja generowania**: po odpowiedzi LLM – INSERT do `generation_sessions` (z `generated_count`) + wiele INSERT do `card_proposals` (z `session_id`, `position`).  
- **Zatwierdzenie**: INSERT do `cards` (source = 'ai_generated'), UPDATE `generation_sessions.accepted_count`, usunięcie lub brak dalszego użytkowania zatwierdzonych propozycji (w MVP brak TTL/crona dla „sierocych” propozycji).  
- **Edycja karty**: UPDATE `cards`; trigger ustawia `updated_at`.  
- **Usunięcie użytkownika**: FK ON DELETE CASCADE czyści `cards` i `generation_sessions` (CASCADE czyści `card_proposals`).

### 5.4 Statystyki

Brak dedykowanego widoku/funkcji agregującej w MVP. Agregaty (np. suma wygenerowanych vs zaakceptowanych) przez zwykłe zapytania na `generation_sessions` (np. SUM(generated_count), SUM(accepted_count) WHERE user_id = auth.uid()).

### 5.5 Retencja `card_proposals`

W MVP nie wdrażać TTL ani crona. „Sieroce” propozycje (np. zamknięta przeglądarka bez zapisu) są dopuszczalne. W przyszłości można dodać czyszczenie po wieku (np. 24–48 h) przez pg_cron lub scheduled job (np. Edge Function).

### 5.6 Zgodność z PRD i RODO

- Dane osobowe i treści tylko w tabelach `cards`, `generation_sessions`, `card_proposals`; dostęp wyłącznie dla zalogowanego użytkownika (RLS).  
- Prawo do usunięcia: usunięcie konta (DELETE w auth.users) automatycznie usuwa wszystkie dane użytkownika dzięki FK ON DELETE CASCADE.  
- Brak soft delete; usunięcia są trwałe.

---

*Schemat przygotowany pod migracje Supabase (PostgreSQL); nazewnictwo migracji: `YYYYMMDDHHmmss_krótki_opis.sql` w katalogu `supabase/migrations/`.*
