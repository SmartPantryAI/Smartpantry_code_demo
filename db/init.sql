CREATE DATABASE IF NOT EXISTS smartpantry;
USE smartpantry;

CREATE TABLE IF NOT EXISTS users (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    email         VARCHAR(255),
    name          VARCHAR(100),
    nickname      VARCHAR(100),
    profile_image VARCHAR(500),
    is_agreed     TINYINT(1) DEFAULT 0,
    is_admin      TINYINT(1) DEFAULT 0,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS social_accounts (
    id               BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id          BIGINT NOT NULL,
    provider         ENUM('kakao','google','naver') NOT NULL,
    provider_user_id VARCHAR(255) NOT NULL,
    UNIQUE KEY uq_provider (provider, provider_user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ingredients (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    name                VARCHAR(100) NOT NULL UNIQUE,
    category            VARCHAR(100),
    emoji               VARCHAR(10) DEFAULT '📦',
    storage_type        ENUM('room','cold','frozen') DEFAULT 'cold',
    default_expiry_days INT
);

CREATE TABLE IF NOT EXISTS pantry (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    user_id       BIGINT NOT NULL,
    ingredient_id BIGINT,
    item_name     VARCHAR(100) NOT NULL,
    item_emoji    VARCHAR(10) DEFAULT '📦',
    expiry_date   DATE,
    category      VARCHAR(20) DEFAULT '냉장',
    quantity      DECIMAL(10,2) DEFAULT 1.00,
    unit          VARCHAR(50),
    status        ENUM('available','used','expired','deleted') DEFAULT 'available',
    source        ENUM('manual','receipt','camera') DEFAULT 'manual',
    FOREIGN KEY (user_id)       REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
);

-- 요리 완료 시 사용 처리되어 pantry에서 삭제된 식재료 기록 (낭비 통계용)
CREATE TABLE IF NOT EXISTS used_ingredient_logs (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id     BIGINT NOT NULL,
    item_name   VARCHAR(100) NOT NULL,
    item_emoji  VARCHAR(10) DEFAULT '📦',
    category    VARCHAR(20),
    quantity    DECIMAL(10,2),
    unit        VARCHAR(20) DEFAULT '개',
    expiry_date DATE,
    used_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS recipes (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    title        VARCHAR(255) NOT NULL,
    description  TEXT,
    cooking_time INT,
    difficulty   ENUM('easy','normal','hard') DEFAULT 'easy',
    image_url    VARCHAR(500),
    dish_type    VARCHAR(50), -- mafra TY_NM 원문(예: '밥','국','밑반찬/김치') - is_main_dish 백필에만 쓰이는 mafra 전용 원본값
    is_main_dish TINYINT(1), -- 소스 무관 메인요리 판정(1=메인, 0=디저트/사이드 등) - buildRecipeCandidates 필터링에 사용
    source_api   VARCHAR(20) NOT NULL DEFAULT 'mafra', -- 'mafra' | 'themealdb'
    external_id  VARCHAR(50) NULL, -- 외부 API 원본 id (mafra 데이터는 NULL) - 재실행 시 중복 import 방지
    source_category VARCHAR(50) NULL, -- TheMealDB strCategory 원문(예: 'Beef','Seafood') - mafra는 NULL.
                                       -- buildRecipeCandidates에서 "카테고리가 특정 단백질을 가리키는데
                                       -- 그 재료가 아예 없으면 제외" 판정에 쓰인다(제목에 재료명이
                                       -- 텍스트로 안 들어간 해외 레시피용 보강 신호).
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_recipes_source (source_api, external_id)
);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    recipe_id     BIGINT NOT NULL,
    ingredient_id BIGINT NOT NULL,
    amount        DECIMAL(10,2),
    unit          VARCHAR(50),
    is_required   TINYINT(1) DEFAULT 1,
    FOREIGN KEY (recipe_id)     REFERENCES recipes(id) ON DELETE CASCADE,
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
);

-- 펜트리 상품명(브랜드/가공식품명)을 레시피 매칭용 표준 재료명으로 잇는 별칭 테이블.
-- alias_name과 원재료명이 문자열로 겹치지 않는 경우만 사용(겹치면 기존 부분 문자열 매칭으로 충분).
-- 하나의 alias_name이 여러 canonical_ingredient에 대응할 수 있다(예: 햇반은 "밥"이 필요한 레시피와
-- "쌀"이 필요한 레시피 양쪽에 다 대응돼야 함) - 그래서 UNIQUE를 alias_name 단독이 아니라
-- (alias_name, canonical_ingredient) 조합에 건다.
CREATE TABLE IF NOT EXISTS ingredient_aliases (
    id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
    alias_name           VARCHAR(200) NOT NULL,
    canonical_ingredient VARCHAR(200) NOT NULL,
    source               ENUM('manual','llm') NOT NULL DEFAULT 'llm',
    created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_alias_canonical (alias_name, canonical_ingredient)
);

-- 수동 시드: 실제 pantry.item_name 전수 조사 + canonical_ingredient가 recipe_ingredients에서
-- 실제로 쓰이는 재료명인지 확인 후 추가함(예: '어묵'→'연육'은 '연육'이 recipe_ingredients에 없어서 제외,
-- '어묵' 자체가 이미 재료명으로 존재해 별칭 없이도 직접 매칭됨).
INSERT IGNORE INTO ingredient_aliases (alias_name, canonical_ingredient, source) VALUES
('햇반', '쌀', 'manual'),
('햇반', '밥', 'manual'),
('즉석밥', '쌀', 'manual'),
('즉석밥', '밥', 'manual'),
('오뚜기밥', '쌀', 'manual'),
('오뚜기밥', '밥', 'manual'),
('스팸', '햄', 'manual'),
('런천미트', '햄', 'manual'),
('진미채', '오징어', 'manual'),
('맛살', '게살', 'manual'),
('메추리알', '계란', 'manual'),
('달걀', '계란', 'manual'),
('특란', '계란', 'manual'),
('유정란', '계란', 'manual'),
-- 두반장/쌈장은 '고추장'/'된장'과 문자열이 전혀 겹치지 않아 별칭이 필요하다(둘 다 실사용 있음: 고추장 71건, 된장 30건).
-- 국간장/진간장/맛간장은 이미 '간장'을 부분 문자열로 포함해 기존 매칭으로 충분하므로 추가하지 않음.
('두반장', '고추장', 'manual'),
('쌈장', '된장', 'manual');

CREATE TABLE IF NOT EXISTS recommendation_logs (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id             BIGINT NOT NULL,
    recipe_id           BIGINT,
    recommendation_type ENUM('db_match','llm_generated') NOT NULL,
    input_ingredients   TEXT,
    match_score         DECIMAL(5,2),
    llm_response        JSON,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)   REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id)
);

CREATE TABLE IF NOT EXISTS notices (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    message    TEXT NOT NULL,
    is_active  TINYINT(1) DEFAULT 1,
    push_sent  TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    user_id       BIGINT NOT NULL,
    endpoint      TEXT NOT NULL,
    p256dh        TEXT NOT NULL,
    auth          TEXT NOT NULL,
    endpoint_hash VARCHAR(64) GENERATED ALWAYS AS (SHA2(endpoint, 256)) STORED UNIQUE,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS saved_recipes (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id     BIGINT NOT NULL,
    recipe_name VARCHAR(200) NOT NULL,
    recipe_json JSON NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 영수증/식재료 촬영 스캔 로그 (이미지 포함) — 기존에 코드에서만 쓰이고 스키마에 빠져 있던 테이블 보강
CREATE TABLE IF NOT EXISTS scan_logs (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id     BIGINT NOT NULL,
    mode        ENUM('food','receipt') DEFAULT 'food',
    source      VARCHAR(50),
    image_data  MEDIUMTEXT,
    item_count  INT DEFAULT 0,
    items_json  JSON,
    status      ENUM('success','failed') DEFAULT 'success',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 항목별 동의 현황 (필수: terms, age14, privacy, pantry_data / 선택: camera, push, marketing)
CREATE TABLE IF NOT EXISTS user_consents (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    consent_type    ENUM('terms','age14','privacy','pantry_data','camera','push','marketing') NOT NULL,
    agreed          TINYINT(1) NOT NULL DEFAULT 0,
    consent_version VARCHAR(30) NOT NULL,
    agreed_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_user_consent (user_id, consent_type),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 동의 변경/철회 이력 (분쟁 대비 보존용, UPDATE 없이 누적 INSERT)
CREATE TABLE IF NOT EXISTS user_consent_history (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    consent_type    ENUM('terms','age14','privacy','pantry_data','camera','push','marketing') NOT NULL,
    previous_value  TINYINT(1),
    new_value       TINYINT(1) NOT NULL,
    consent_version VARCHAR(30) NOT NULL,
    changed_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 기존에 is_agreed=1로 가입된 회원은 필수 항목을 동의 완료로 간주하고 마이그레이션
-- (선택 항목 camera/push/marketing은 행을 만들지 않아 미동의 상태로 시작됨)
INSERT IGNORE INTO user_consents (user_id, consent_type, agreed, consent_version, agreed_at)
SELECT id, t.consent_type, 1, t.ver, COALESCE(created_at, NOW())
FROM users
CROSS JOIN (
    SELECT 'terms' AS consent_type, 'terms_v1' AS ver UNION ALL
    SELECT 'age14', 'age14_v1' UNION ALL
    SELECT 'privacy', 'privacy_v1' UNION ALL
    SELECT 'pantry_data', 'pantry_v1'
) t
WHERE is_agreed = 1;
