export const vertexSource = `#version 300 es
layout(location = 0) in vec3 in_position;
layout(location = 1) in float in_intensity;
layout(location = 2) in float in_colorIndex;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;

out float vIntensity;
out float vColorIndex;

void main() {
  vec4 world = uModel * vec4(in_position, 1.0);
  vec4 viewPos = uView * world;
  float dist = max(length(viewPos.xyz), 0.01);
  gl_Position = uProjection * viewPos;
  float size = 8.0 / dist;
  gl_PointSize = clamp(size, 1.5, 12.0);
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

void main() {
  vec2 centered = gl_PointCoord * 2.0 - 1.0;
  float d = dot(centered, centered);
  float falloff = clamp(1.0 - smoothstep(0.0, 1.0, d), 0.0, 1.0);
  float alpha = falloff;
  vec3 color = texture(uPalette, vec2(vColorIndex, 0.5)).rgb * vIntensity;
  fragColor = vec4(color, alpha);
}
`;
