export const jupiterVertexSource = `#version 300 es
layout(location = 0) in vec3 in_position;
layout(location = 1) in float in_size;
layout(location = 2) in vec3 in_color;

uniform mat4 uView;
uniform mat4 uProjection;

out vec3 vColor;

void main() {
  vec4 viewPos = uView * vec4(in_position, 1.0);
  float dist = max(length(viewPos.xyz), 0.01);
  gl_Position = uProjection * viewPos;
  gl_PointSize = clamp(in_size / dist, 2.0, 240.0);
  vColor = in_color;
}
`;

export const jupiterFragmentSource = `#version 300 es
precision highp float;

in vec3 vColor;
out vec4 fragColor;

void main() {
  vec2 centered = gl_PointCoord * 2.0 - 1.0;
  float r = length(centered);
  float core = smoothstep(1.0, 0.0, r);
  float glow = smoothstep(1.25, 0.75, r) * 0.35;
  float alpha = clamp(core + glow, 0.0, 1.0);
  vec3 color = vColor * (1.0 + glow * 0.4);
  fragColor = vec4(color, alpha);
}
`;
