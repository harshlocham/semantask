import { seedE2eWorld } from "./seed";

export default async function globalSetup(): Promise<void> {
    await seedE2eWorld();
}
