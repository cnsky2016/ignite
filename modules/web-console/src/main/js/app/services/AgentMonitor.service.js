/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import io from 'socket.io-client'; // eslint-disable-line no-unused-vars

class IgniteAgentMonitor {
    constructor(socketFactory, $root, $q, $state, $modal, $common) {
        this._scope = $root.$new();

        $root.$on('$stateChangeStart', () => {
            this.stopWatch();
        });

        // Pre-fetch modal dialogs.
        this._downloadAgentModal = $modal({
            scope: this._scope,
            templateUrl: '/templates/agent-download.html',
            show: false,
            backdrop: 'static'
        });

        const _modalHide = this._downloadAgentModal.hide;

        /**
         * Special dialog hide function.
         */
        this._downloadAgentModal.hide = () => {
            $common.hideAlert();

            _modalHide();
        };

        /**
         * Close dialog and go by specified link.
         */
        this._scope.back = () => {
            this.stopWatch();

            if (this._scope.backState)
                this._scope.$$postDigest(() => $state.go(this._scope.backState));
        };

        this._scope.downloadAgent = () => {
            const lnk = document.createElement('a');

            lnk.setAttribute('href', '/api/v1/agent/download/zip');
            lnk.setAttribute('target', '_self');
            lnk.setAttribute('download', null);
            lnk.style.display = 'none';

            document.body.appendChild(lnk);

            lnk.click();

            document.body.removeChild(lnk);
        };

        this._scope.hasAgents = null;
        this._scope.showModal = false;

        this._evtOrderKey = $common.randomString(20);
        this._evtThrottleCntrKey = $common.randomString(20);

        /**
         * @type {Socket}
         */
        this._socket = null;

        this._socketFactory = socketFactory;

        this._$q = $q;

        this._$common = $common;
    }

    /**
     * @private
     */
    checkModal() {
        if (this._scope.showModal && !this._scope.hasAgents)
            this._downloadAgentModal.$promise.then(this._downloadAgentModal.show);
        else if ((this._scope.hasAgents || !this._scope.showModal) && this._downloadAgentModal.$isShown)
            this._downloadAgentModal.hide();
    }

    /**
     * @returns {Promise}
     */
    awaitAgent() {
        if (this._scope.hasAgents)
            return this._$q.when();

        if (this._scope.hasAgents !== null)
            this.checkModal();

        const latch = this._$q.defer();

        const offConnected = this._scope.$on('agent:connected', (event, success) => {
            offConnected();

            if (success)
                return latch.resolve();

            latch.reject();
        });

        return latch.promise;
    }

    init() {
        this._socket = this._socketFactory();

        this._socket.on('connect_error', () => {
            this._scope.hasAgents = false;
        });

        this._socket.on('agent:count', ({count}) => {
            this._scope.hasAgents = count > 0;

            this.checkModal();

            if (this._scope.hasAgents)
                this._scope.$broadcast('agent:connected', true);
        });

        this._socket.on('disconnect', () => {
            this._scope.hasAgents = false;

            this.checkModal();
        });
    }

    /**
     * @param {Object} back
     * @returns {Promise}
     */
    startWatch(back) {
        this._scope.backState = back.state;
        this._scope.backText = back.text;

        this._scope.agentGoal = back.goal;

        this._scope.showModal = true;

        return this.awaitAgent();
    }

    /**
     *
     * @param {String} event
     * @param {Object} [args]
     * @returns {Promise}
     * @private
     */
    _emit(event, ...args) {
        if (!this._socket)
            return this._$q.reject('Failed to connect to agent');

        const latch = this._$q.defer();

        const onDisconnect = () => {
            this._socket.removeListener('disconnect', onDisconnect);

            latch.reject('Connection to server was closed');
        };

        this._socket.on('disconnect', onDisconnect);

        args.push((err, res) => {
            this._socket.removeListener('disconnect', onDisconnect);

            if (err)
                latch.reject(err);

            latch.resolve(res);
        });

        this._socket.emit(event, ...args);

        return latch.promise;
    }

    drivers() {
        return this._emit('schemaImport:drivers');
    }

    /**
     *
     * @param {Object} preset
     * @returns {Promise}
     */
    schemas(preset) {
        return this._emit('schemaImport:schemas', preset);
    }

    /**
     *
     * @param {Object} preset
     * @returns {Promise}
     */
    tables(preset) {
        return this._emit('schemaImport:tables', preset);
    }

    /**
     * @param {String} errMsg
     */
    showNodeError(errMsg) {
        this._downloadAgentModal.show();

        this._$common.showError(errMsg);
    }

    /**
     *
     * @param {String} event
     * @param {Object} [args]
     * @returns {Promise}
     * @private
     */
    _rest(event, ...args) {
        return this._downloadAgentModal.$promise
            .then(() => this._emit(event, ...args));
    }

    /**
     * @param {Boolean} [attr]
     * @param {Boolean} [mtr]
     * @returns {Promise}
     */
    topology(attr, mtr) {
        return this._rest('node:topology', !!attr, !!mtr);
    }

    /**
     * @param {int} [queryId]
     * @returns {Promise}
     */
    queryClose(queryId) {
        return this._rest('node:query:close', queryId);
    }

    /**
     * @param {String} cacheName Cache name.
     * @param {int} pageSize
     * @param {String} [query] Query if null then scan query.
     * @returns {Promise}
     */
    query(cacheName, pageSize, query) {
        return this._rest('node:query', _.isEmpty(cacheName) ? null : cacheName, pageSize, query);
    }

    /**
     * @param {String} cacheName Cache name.
     * @param {String} [query] Query if null then scan query.
     * @returns {Promise}
     */
    queryGetAll(cacheName, query) {
        return this._rest('node:query:getAll', _.isEmpty(cacheName) ? null : cacheName, query);
    }

    /**
     * @param {String} [cacheName] Cache name.
     * @returns {Promise}
     */
    metadata(cacheName) {
        return this._rest('node:cache:metadata', _.isEmpty(cacheName) ? null : cacheName);
    }

    /**
     * @param {int} queryId
     * @param {int} pageSize
     * @returns {Promise}
     */
    next(queryId, pageSize) {
        return this._rest('node:query:fetch', queryId, pageSize);
    }

    collect() {
        return this._rest('node:visor:collect', this._evtOrderKey, this._evtThrottleCntrKey);
    }

    /**
     * Clear specified cache on specified node.
     * @param {String} nid Node id.
     * @param {String} cacheName Cache name.
     * @returns {Promise}
     */
    cacheClear(nid, cacheName) {
        return this._rest('node:cache:clear', nid, cacheName);
    }

    /**
     * Stop specified cache on specified node.
     * @param {String} nid Node id.
     * @param {String} cacheName Cache name.
     * @returns {Promise}
     */
    cacheStop(nid, cacheName) {
        return this._rest('node:cache:stop', nid, cacheName);
    }

    /**
     * Ping node.
     * @param {String} nid Node id.
     * @returns {Promise}
     */
    ping(nid) {
        return this._rest('node:ping', nid);
    }

    stopWatch() {
        this._scope.showModal = false;

        this.checkModal();

        this._scope.$broadcast('agent:connected', false);
    }
}

IgniteAgentMonitor.$inject = ['igniteSocketFactory', '$rootScope', '$q', '$state', '$modal', '$common'];

export default ['IgniteAgentMonitor', IgniteAgentMonitor];
