import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

/** With exactly one active plant (today: DPNL) new reports belong to it; with several the admin picks one per report. */
export async function defaultPlantId(client: Prisma.TransactionClient = prisma): Promise<string | null> {
  const plants = await client.plant.findMany({ where: { isActive: true }, select: { id: true }, take: 2 });
  return plants.length === 1 ? plants[0]!.id : null;
}
