import amqp, { type Channel, type ChannelModel } from "amqplib";

import { appConfig } from "@/lib/config";

const globalForBus = globalThis as typeof globalThis & {
  __pfrmBusConnection?: Promise<ChannelModel>;
};

export async function getBusConnection() {
  if (!globalForBus.__pfrmBusConnection) {
    globalForBus.__pfrmBusConnection = amqp.connect(appConfig.rabbitmqUrl);
  }

  return globalForBus.__pfrmBusConnection;
}

export async function createBusChannel(): Promise<Channel> {
  const connection = await getBusConnection();
  return connection.createChannel();
}
