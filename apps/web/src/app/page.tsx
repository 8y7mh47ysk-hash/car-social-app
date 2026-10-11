import { APP_NAME } from "@apex/shared";

// The first features from the owner's playbook. This placeholder page is replaced by the app
// shell (instruction 17) and the Garage page (instruction 49).
const PLANNED_FEATURES = [
  { name: "Garage", description: "A profile for each car: specs, mileage, photos, VIN and notes." },
  { name: "Build Log", description: "A timeline of mods, costs, dyno and lap results." },
  { name: "Maintenance", description: "Service schedules, mileage and date reminders, receipts." },
  { name: "Parts Locker", description: "Parts you own or plan to buy, with a budget tracker." },
  { name: "Crew Chief", description: "An AI assistant for your car that runs on your own server." },
] as const;

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-10 px-6 py-16">
      <div className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{APP_NAME}</h1>
        <p className="text-lg text-neutral-700 dark:text-neutral-300">
          A self-hosted garage for people who own and modify cars. It is being built now.
        </p>
      </div>
      <section aria-labelledby="planned-features" className="space-y-4">
        <h2 id="planned-features" className="text-xl font-semibold">
          Coming soon
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {PLANNED_FEATURES.map((feature) => (
            <li
              key={feature.name}
              className="rounded-lg border border-neutral-300 p-4 dark:border-neutral-700"
            >
              <h3 className="font-semibold">{feature.name}</h3>
              <p className="text-neutral-700 dark:text-neutral-300">{feature.description}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
