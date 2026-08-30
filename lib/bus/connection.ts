import amqp, { type Channel, type ChannelModel } from "amqplib";

import { appConfig } from "@/lib/config";

const globalForBus = globalThis as typeof globalThis & {
  __cidadelaBusConnection?: Promise<ChannelModel>;
};

export async function getBusConnection() {
  if (!globalForBus.__cidadelaBusConnection) {
    globalForBus.__cidadelaBusConnection = amqp.connect(appConfig.rabbitmqUrl);
  }

  return globalForBus.__cidadelaBusConnection;
}

export async function createBusChannel(): Promise<Channel> {
  const connection = await getBusConnection();
  return connection.createChannel();
}
