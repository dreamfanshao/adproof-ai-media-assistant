import { InMemoryXhsConnectionService } from "../../../server/src/services/xhs-connection-service.js";

const service = new InMemoryXhsConnectionService();

try {
  const connection = await service.create("00000000-0000-4000-8000-000000000000");
  console.log(JSON.stringify({
    status: connection.status,
    hasQrImage: Boolean(connection.qr_image_url),
    messageCode: connection.message_code,
  }));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unknown QR smoke failure");
  process.exitCode = 1;
} finally {
  await service.closeAll();
}
