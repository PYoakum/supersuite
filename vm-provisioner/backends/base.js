/**
 * Backend interface contract (JSDoc documentation only)
 *
 * Each backend module must export these functions:
 *
 * @function create
 * @param {object} vm - VM entry from registry
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 *
 * @function start
 * @param {object} vm - VM entry from registry
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 *
 * @function stop
 * @param {object} vm - VM entry from registry
 * @returns {Promise<{success: boolean, error?: string}>}
 *
 * @function destroy
 * @param {object} vm - VM entry from registry
 * @returns {Promise<{success: boolean, error?: string}>}
 *
 * @function getStats
 * @param {object} vm - VM entry from registry
 * @returns {Promise<{success: boolean, data?: {networkRxBytes: number, networkTxBytes: number, ip: string}, error?: string}>}
 *
 * @function isRunning
 * @param {object} vm - VM entry from registry
 * @returns {Promise<boolean>}
 */
