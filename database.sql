-- Jalankan file ini di database MySQL Railway
-- Bisa via Railway CLI atau MySQL client

CREATE TABLE IF NOT EXISTS items (
  id         VARCHAR(50)   PRIMARY KEY,
  name       VARCHAR(150)  NOT NULL,
  category   VARCHAR(80)   NOT NULL DEFAULT 'Lainnya',
  sku        VARCHAR(50)   NOT NULL UNIQUE,
  price      DECIMAL(15,2) NOT NULL DEFAULT 0,
  cost       DECIMAL(15,2) NOT NULL DEFAULT 0,
  stock      INT           NOT NULL DEFAULT 0,
  min_stock  INT           NOT NULL DEFAULT 3,
  unit       VARCHAR(20)   NOT NULL DEFAULT 'pcs',
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transactions (
  id            VARCHAR(50)   PRIMARY KEY,
  invoice_no    VARCHAR(30)   NOT NULL UNIQUE,
  customer_name VARCHAR(100)  NOT NULL DEFAULT 'Umum',
  total         DECIMAL(15,2) NOT NULL DEFAULT 0,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transaction_items (
  id             VARCHAR(50)   PRIMARY KEY,
  transaction_id VARCHAR(50)   NOT NULL,
  item_id        VARCHAR(50)   NOT NULL,
  item_name      VARCHAR(150)  NOT NULL,
  price          DECIMAL(15,2) NOT NULL DEFAULT 0,
  quantity       INT           NOT NULL DEFAULT 1,
  subtotal       DECIMAL(15,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id)        REFERENCES items(id)        ON DELETE RESTRICT
) ENGINE=InnoDB;
