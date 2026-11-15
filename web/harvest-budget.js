// Magical Wonder Night: both new crops cost four Weird Jelly Beans per
// planting and have a 40-minute base timer (client build 3934365). Two waterings
// reduce it to 30 minutes; do not apply watering to the card timer twice. No minimum crop reserve is automatic.
export function harvestBudgetStatus(plots, budget, watered = true) {
    const seconds = 2400 * (watered ? 0.75 : 1);
    const count = Math.max(0, Number(plots) || 0);
    const needed = count * 2 * 4 * 86400 / seconds;
    return { needed, spare: budget === null ? null : Math.max(0, budget - needed),
        conflict: budget !== null && budget + 1e-9 < needed, watered };
}
