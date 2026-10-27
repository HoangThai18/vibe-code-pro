-- Fixed 30-minute slots: one row per slot a booking covers; the primary key is the guard
CREATE TABLE appointment_slots (
  tenant_id      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  staff_user_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slot_start     DATETIME NOT NULL,   -- UTC, on the :00 / :30 grid
  appointment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (tenant_id, staff_user_id, slot_start),   -- 1062 on this key: 409 appointment_slot_taken
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments (tenant_id, id) ON DELETE CASCADE
)
