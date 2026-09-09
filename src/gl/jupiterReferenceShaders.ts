export const jupiterReferenceVertexSource = `#version 300 es
layout(location = 0) in vec3 in_position;
layout(location = 1) in vec4 in_color;

uniform mat4 uView;
uniform mat4 uProjection;

out vec4 vColor;

void main() {
  gl_Position = uProjection * uView * vec4(in_position, 1.0);
  vColor = in_color;
}
`;

export const jupiterReferenceFragmentSource = `#version 300 es
precision highp float;

in vec4 vColor;
out vec4 fragColor;

void main() {
  fragColor = vColor;
}
`;
