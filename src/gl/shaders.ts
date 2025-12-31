export const vertexSource = `#version 300 es
layout(location = 0) in vec3 in_position;
layout(location = 1) in float in_intensity;
layout(location = 2) in float in_colorIndex;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;
uniform float uStarSizeScale;

out float vIntensity;
out float vColorIndex;

void main() {
  vec4 world = uModel * vec4(in_position, 1.0);
  vec4 viewPos = uView * world;
  float dist = max(length(viewPos.xyz), 0.01);
  gl_Position = uProjection * viewPos;
  float brightness = clamp(in_intensity, 0.0, 4.0);
  float sizeFactor = clamp(uStarSizeScale, 0.0, 1.0);
  float baseSize = mix(5.0, 24.0, clamp(brightness * 0.4, 0.0, 1.0));
  float size = baseSize / dist;
  float scaledSize = size * mix(0.05, 1.0, sizeFactor);
  float minSize = mix(1.0, 2.0, sizeFactor);
  gl_PointSize = clamp(scaledSize, minSize, 18.0);
  vIntensity = in_intensity;
  vColorIndex = clamp(in_colorIndex, 0.0, 1.0);
}
`;

export const fragmentSource = `#version 300 es
precision highp float;
in float vIntensity;
in float vColorIndex;
uniform sampler2D uPalette;
out vec4 fragColor;

float hash2d(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 centered = gl_PointCoord * 2.0 - 1.0;
  float r = length(centered);
  float wobble = mix(0.88, 1.12, hash2d(gl_FragCoord.xy + vColorIndex * 123.0));
  float soft = exp(-pow(r * wobble, 2.4));
  float haze = exp(-pow(r * 0.75 * wobble, 1.6));
  float halo = clamp(soft + haze * 0.65, 0.0, 1.0);
  float alpha = halo * clamp(vIntensity * 1.1, 0.1, 1.0);

  vec3 baseColor = texture(uPalette, vec2(vColorIndex, 0.5)).rgb * vIntensity;
  vec3 dustTint = vec3(0.9, 0.72, 0.55);
  vec3 color = mix(baseColor, dustTint * vIntensity, haze * 0.25);

  fragColor = vec4(color, alpha);
}
`;
