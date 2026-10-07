import { Pool } from "pg";
import { env } from "../config/env.js";

const pool = new Pool({ connectionString: env.DATABASE_URL });

const ITEM_BATCH_SIZE = 200;
const SERVICE_BATCH_SIZE = 200;
const ITEM_REQUEST_COUNT = 2000;
const SERVICE_REQUEST_COUNT = 2000;

const ITEM_TYPES = ["out", "purchase", "payment", "pending"];
const ENGINEERING_DEPARTMENT = "ENGG";

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

const padNumber = (value: number, length = 4): string => String(value).padStart(length, "0");

async function getUsersByRoles(roles: string[], department?: string) {
  const departmentClause = department ? ` AND department = $2::text` : "";
  const params = department ? [roles, department] : [roles];
  const result = await pool.query(
    `SELECT id, role, department FROM users WHERE role = ANY($1::text[])${departmentClause}`,
    params
  );
  return result.rows;
}

async function insertItemRequests(startIndex: number, count: number, staffUsers: any[]) {
  const values: string[] = [];
  const params: any[] = [];

  for (let i = 0; i < count; i += 1) {
    const serial = `IRS-00-${new Date().getFullYear()}-${padNumber(startIndex + i, 6)}`;
    const createdBy = pick(staffUsers).id;
    const department = ENGINEERING_DEPARTMENT;
    const purpose = `Auto-generated item request ${serial}`;
    const remarks = `Bulk-generated request ${serial}`;
    const requestType = pick(ITEM_TYPES);
    const createdAt = new Date().toISOString();

    params.push(
      serial,
      department,
      createdBy,
      purpose,
      remarks,
      "pending",
      "pending",
      null,
      null,
      "pending",
      null,
      null,
      null,
      requestType,
      null,
      null,
      createdAt
    );

    const offset = params.length - 17;
    values.push(
      `($${offset + 1}::text, $${offset + 2}::text, $${offset + 3}::uuid, $${offset + 4}::text, $${offset + 5}::text, $${offset + 6}::text, $${offset + 7}::text, $${offset + 8}::uuid, $${offset + 9}::text, $${offset + 10}::text, $${offset + 11}::uuid, $${offset + 12}::text, $${offset + 13}::text, $${offset + 14}::text, $${offset + 15}::text, $${offset + 16}::text, $${offset + 17}::text)`
    );
  }

  const query = `INSERT INTO item_requests (serial, department, created_by, purpose, remarks, status, supervisor_status, supervisor_approved_by, supervisor_approved_at, custodian_status, custodian_approved_by, custodian_approved_at, rejection_comment, request_type, attachment, attachment_name, created_at) VALUES ${values.join(", ")} RETURNING id`;
  const result = await pool.query(query, params);
  const ids = result.rows.map((row) => row.id);

  const itemParams: any[] = [];
  const itemValues: string[] = [];

  ids.forEach((requestId, index) => {
    const itemName = `Item ${padNumber(startIndex + index)}`;
    const quantity = Math.ceil(Math.random() * 5);
    const uom = "pcs";
    const remarks = "Generated item row";

    itemParams.push(requestId, itemName, quantity, uom, remarks, null, null, null, null);
    const itemOffset = itemParams.length - 9;
    itemValues.push(
      `($${itemOffset + 1}::integer, $${itemOffset + 2}::text, $${itemOffset + 3}::integer, $${itemOffset + 4}::text, $${itemOffset + 5}::text, $${itemOffset + 6}::text, $${itemOffset + 7}::text, $${itemOffset + 8}::text, $${itemOffset + 9}::integer)`
    );
  });

  await pool.query(
    `INSERT INTO item_request_items (request_id, item_name, quantity, uom, remarks, issuance_number, pr_number, delivery_status, quantity_delivered) VALUES ${itemValues.join(", ")}`,
    itemParams
  );
}

async function insertServiceRequests(startIndex: number, count: number, staffUsers: any[]) {
  const values: string[] = [];
  const params: any[] = [];

  for (let i = 0; i < count; i += 1) {
    const serial = `SRS-00-${new Date().getFullYear()}-${padNumber(startIndex + i, 6)}`;
    const createdBy = pick(staffUsers).id;
    const department = ENGINEERING_DEPARTMENT;
    const purpose = `Auto-generated service request ${serial}`;
    const remarks = `Bulk-generated request ${serial}`;
    const createdAt = new Date().toISOString();

    params.push(
      serial,
      department,
      createdBy,
      purpose,
      remarks,
      "pending",
      "pending",
      null,
      null,
      "pending",
      null,
      null,
      null,
      null,
      null,
      createdAt
    );

    const offset = params.length - 16;
    values.push(
      `($${offset + 1}::text, $${offset + 2}::text, $${offset + 3}::uuid, $${offset + 4}::text, $${offset + 5}::text, $${offset + 6}::text, $${offset + 7}::text, $${offset + 8}::uuid, $${offset + 9}::text, $${offset + 10}::text, $${offset + 11}::uuid, $${offset + 12}::text, $${offset + 13}::text, $${offset + 14}::text, $${offset + 15}::text, $${offset + 16}::text)`
    );
  }

  const query = `INSERT INTO service_requests (serial, department, created_by, purpose, remarks, status, supervisor_status, supervisor_approved_by, supervisor_approved_at, custodian_status, custodian_approved_by, custodian_approved_at, rejection_comment, pr_number, pr_status, created_at) VALUES ${values.join(", ")} RETURNING id`;
  const result = await pool.query(query, params);
  const ids = result.rows.map((row) => row.id);

  const serviceParams: any[] = [];
  const serviceValues: string[] = [];

  ids.forEach((requestId, index) => {
    const description = `Service item ${padNumber(startIndex + index)}`;
    const prNumber = null;
    const prStatus = null;
    const deliveryStatus = null;

    serviceParams.push(requestId, description, deliveryStatus, prNumber, prStatus);
    const serviceOffset = serviceParams.length - 5;
    serviceValues.push(
      `($${serviceOffset + 1}::integer, $${serviceOffset + 2}::text, $${serviceOffset + 3}::text, $${serviceOffset + 4}::text, $${serviceOffset + 5}::text)`
    );
  });

  await pool.query(
    `INSERT INTO service_items (service_request_id, description, delivery_status, pr_number, pr_status) VALUES ${serviceValues.join(", ")}`,
    serviceParams
  );
}

async function main() {
  console.log("Starting bulk seeding of requests...");

  const users = await getUsersByRoles(["staff", "supervisor"], ENGINEERING_DEPARTMENT);
  if (users.length === 0) {
    throw new Error("No staff or supervisor users found in the database.");
  }

  const itemCountResult = await pool.query("SELECT COALESCE(MAX(id), 0) AS max_id FROM item_requests");
  const serviceCountResult = await pool.query("SELECT COALESCE(MAX(id), 0) AS max_id FROM service_requests");

  const itemStart = Number(itemCountResult.rows[0].max_id) + 1;
  const serviceStart = Number(serviceCountResult.rows[0].max_id) + 1;

  console.log(`Inserting ${ITEM_REQUEST_COUNT} item requests in batches of ${ITEM_BATCH_SIZE}...`);
  for (let start = itemStart; start < itemStart + ITEM_REQUEST_COUNT; start += ITEM_BATCH_SIZE) {
    const batchSize = Math.min(ITEM_BATCH_SIZE, itemStart + ITEM_REQUEST_COUNT - start);
    console.log(`  Item batch: ${start}..${start + batchSize - 1}`);
    await insertItemRequests(start, batchSize, users);
  }

  console.log(`Inserting ${SERVICE_REQUEST_COUNT} service requests in batches of ${SERVICE_BATCH_SIZE}...`);
  for (let start = serviceStart; start < serviceStart + SERVICE_REQUEST_COUNT; start += SERVICE_BATCH_SIZE) {
    const batchSize = Math.min(SERVICE_BATCH_SIZE, serviceStart + SERVICE_REQUEST_COUNT - start);
    console.log(`  Service batch: ${start}..${start + batchSize - 1}`);
    await insertServiceRequests(start, batchSize, users);
  }

  console.log("Bulk seeding completed successfully.");
  await pool.end();
}

main().catch((error) => {
  console.error("Bulk seeding failed:", error);
  pool.end().finally(() => process.exit(1));
});
