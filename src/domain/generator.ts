import { GalaxyParameters, StarBuffer } from "./parameters";

function nextGaussian(rand: () => number) {
  const u1 = 1 - rand();
  const u2 = 1 - rand();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

export async function generateStars(
  params: GalaxyParameters,
  signal?: AbortSignal
): Promise<StarBuffer> {
  const random = Math.random;
  const stars: number[] = [];
  const diskRadius = Math.max(1, params.diskRadius);
  const diskEdge = diskRadius * 0.98;
  const armCount = Math.max(1, params.armCount);
  const armStart = Math.max(0.5, Math.min(diskRadius * 0.9, params.bulgeRadius));
  const spiralLogMax = Math.log(diskRadius / armStart);
  const spiralNorm = spiralLogMax > 0 ? 1 / spiralLogMax : 0;

  for (let i = 0; i < params.starCount; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const armIndex = Math.floor(random() * armCount);
    const baseRadius = diskRadius * Math.pow(random(), 1.6);
    const armAngle = (armIndex * Math.PI * 2) / armCount;
    const radiusForTwist = Math.max(baseRadius, armStart);
    const twist = params.armTwist * Math.log(radiusForTwist / armStart) * spiralNorm;
    const angleNoise = nextGaussian(random) * params.armSpread;
    const angle = armAngle + twist + angleNoise;

    const radialNoise = nextGaussian(random) * params.noise * diskRadius * 0.25;
    const radius = clamp(baseRadius + radialNoise, 0.05, diskEdge);

    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle);
    const z = nextGaussian(random) * params.verticalThickness;

    const radial01 = radius / diskRadius;
    const coreFalloff = Math.pow(Math.max(0, 1 - radial01), params.coreFalloff);

    let intensity = params.brightness * coreFalloff;
    intensity += random() * 0.04 - 0.02;
    intensity = clamp(intensity, 0.003, Number.MAX_VALUE);

    let quantized = Math.pow(intensity, 0.7);
    quantized += (random() - 0.5) * (1 / 255);
    const colorIndex = clamp(quantized, 0, 1);

    stars.push(x, z, y, intensity, colorIndex);
  }

  // Bulge
  const bulgeRand = Math.random;
  const bulgeRadius = Math.max(0.1, params.bulgeRadius);
  const rMin = 0.1;
  const invRMin = 1 / rMin;
  const invRMax = 1 / bulgeRadius;
  const invRange = invRMin - invRMax;

  for (let i = 0; i < params.bulgeStarCount; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const u = bulgeRand();
    const invR = invRMin - u * invRange;
    const radius = clamp(1 / invR, rMin, bulgeRadius);
    const armIndex = Math.floor(bulgeRand() * armCount);
    const armAngle = (armIndex * Math.PI * 2) / armCount;
    const radiusForTwist = Math.max(radius, armStart);
    const twist = params.armTwist * Math.log(radiusForTwist / armStart) * spiralNorm;
    const angleNoise = nextGaussian(bulgeRand) * params.armSpread;
    const angle = armAngle + twist + angleNoise;
    const sigmaZ = params.verticalThickness * params.bulgeVerticalScale;
    const z = nextGaussian(bulgeRand) * sigmaZ;
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle);

    let intensity = params.bulgeBrightness * Math.pow(1 - radius / bulgeRadius, params.bulgeFalloff);
    intensity += bulgeRand() * 0.08 - 0.04;
    intensity = clamp(intensity, 0.05, Number.MAX_VALUE);

    let quantized = Math.pow(intensity, 0.6);
    quantized += (bulgeRand() - 0.5) * (1 / 255);
    const colorIndex = clamp(quantized, 0, 1);

    stars.push(x, z, y, intensity, colorIndex);
  }

  const data = new Float32Array(stars);
  return { data, count: data.length / 5 };
}

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}
