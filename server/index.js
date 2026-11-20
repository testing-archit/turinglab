'use strict';
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 8080;
createApp().listen(PORT, () => console.log(`TuringLab running at http://localhost:${PORT}`));
