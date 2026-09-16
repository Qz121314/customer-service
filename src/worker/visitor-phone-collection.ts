const PHONE_DIGIT_RUN = /\d{7,}/gu;
const BACKFILL_BATCH_SIZE = 100;
const SCAN_RETENTION_MS = 48 * 60 * 60 * 1000;

type VisitorPhoneMessage = {
  id: string;
  body: string;
  created_at: string;
};

export function extractVisitorPhoneNumbers(body: string): string[] {
  return [...new Set(body.match(PHONE_DIGIT_RUN) ?? [])];
}

export async function collectVisitorPhoneMessage(
  db: D1Database,
  message: VisitorPhoneMessage,
): Promise<number> {
  const numbers = extractVisitorPhoneNumbers(message.body);
  if (numbers.length === 0) return 0;

  await db.batch([
    ...numbers.map((number) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO visitor_phone_numbers
               (number, first_collected_at)
             VALUES (?1, ?2)`,
        )
        .bind(number, message.created_at),
    ),
    db
      .prepare(
        `INSERT OR IGNORE INTO visitor_phone_collection_scans
             (message_id, scanned_at)
           VALUES (?1, ?2)`,
      )
      .bind(message.id, new Date().toISOString()),
  ]);
  return numbers.length;
}

export async function collectRecentVisitorPhoneMessages(
  db: D1Database,
  now = new Date(),
): Promise<number> {
  const nowIso = now.toISOString();
  const cutoffIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  await db
    .prepare(
      `DELETE FROM visitor_phone_collection_scans
       WHERE scanned_at < ?1`,
    )
    .bind(new Date(now.getTime() - SCAN_RETENTION_MS).toISOString())
    .run();
  const result = await db
    .prepare(
      `SELECT m.id, m.body, m.created_at
       FROM messages m
       LEFT JOIN visitor_phone_collection_scans scan
         ON scan.message_id = m.id
       WHERE m.sender_type = 'visitor'
         AND m.created_at >= ?1
         AND m.body GLOB '*[0-9][0-9][0-9][0-9][0-9][0-9][0-9]*'
         AND scan.message_id IS NULL
       ORDER BY m.created_at ASC, m.id ASC
       LIMIT ?2`,
    )
    .bind(cutoffIso, BACKFILL_BATCH_SIZE)
    .all<VisitorPhoneMessage>();
  const messages = result.results ?? [];
  if (messages.length === 0) return 0;

  const statements: D1PreparedStatement[] = [];
  for (const message of messages) {
    for (const number of extractVisitorPhoneNumbers(message.body)) {
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO visitor_phone_numbers
               (number, first_collected_at)
             VALUES (?1, ?2)`,
          )
          .bind(number, message.created_at),
      );
    }
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO visitor_phone_collection_scans
             (message_id, scanned_at)
           VALUES (?1, ?2)`,
        )
        .bind(message.id, nowIso),
    );
  }
  await db.batch(statements);
  return messages.length;
}
