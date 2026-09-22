#!/usr/bin/env node
import { runServer } from './server.js';
runServer(process.argv.slice(2).includes('--local-delivery')).catch(() => { process.stderr.write('server_start_failed\n'); process.exitCode = 1; });
