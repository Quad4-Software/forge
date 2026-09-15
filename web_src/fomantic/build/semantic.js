/*
 * # Fomantic UI - 2.9.4
 * https://github.com/fomantic/Fomantic-UI
 * https://fomantic-ui.com/
 *
 * Copyright 2026 Contributors
 * Released under the MIT license
 * https://opensource.org/licenses/MIT
 *
 */
/*!
 * # Fomantic-UI 2.9.4 - API
 * https://github.com/fomantic/Fomantic-UI/
 *
 *
 * Released under the MIT license
 * https://opensource.org/licenses/MIT
 *
 */

(function ($, window, document) {
    'use strict';

    function isWindow(obj) {
        return obj !== null && obj === obj.window;
    }

    function isFunction(obj) {
        return typeof obj === 'function' && typeof obj.nodeType !== 'number';
    }

    window = window !== undefined && window.Math === Math
        ? window
        : globalThis;

    $.fn.api = function (parameters) {
        var
            // use window context if none specified
            $allModules     = isFunction(this)
                ? $(window)
                : $(this),
            time           = Date.now(),
            performance    = [],

            query          = arguments[0],
            methodInvoked  = typeof query === 'string',
            queryArguments = [].slice.call(arguments, 1),
            contextCheck   = function (context, win) {
                var $context;
                if ([window, document].indexOf(context) >= 0) {
                    $context = $(context);
                } else {
                    $context = $(win.document).find(context);
                    if ($context.length === 0) {
                        $context = win.frameElement ? contextCheck(context, win.parent) : window;
                    }
                }

                return $context;
            },
            returnedValue
        ;

        $allModules.each(function () {
            var
                settings          = $.isPlainObject(parameters)
                    ? $.extend(true, {}, $.fn.api.settings, parameters)
                    : $.extend({}, $.fn.api.settings),

                // internal aliases
                regExp          = settings.regExp,
                namespace       = settings.namespace,
                metadata        = settings.metadata,
                selector        = settings.selector,
                error           = settings.error,
                className       = settings.className,

                // define namespaces for modules
                eventNamespace  = '.' + namespace,
                moduleNamespace = 'module-' + namespace,

                // element that creates request
                $module         = $(this),
                $form           = $module.closest(selector.form),

                // context used for state
                $context        = settings.stateContext ? contextCheck(settings.stateContext, window) : $module,

                // request details
                ajaxSettings,
                requestSettings,
                url,
                data,
                requestStartTime,
                originalData,

                // standard module
                element         = this,
                context         = $context[0],
                instance        = $module.data(moduleNamespace),
                module
            ;

            module = {

                initialize: function () {
                    if (!methodInvoked) {
                        originalData = settings.data;
                        module.bind.events();
                    }
                    module.instantiate();
                },

                instantiate: function () {
                    module.verbose('Storing instance of module', module);
                    instance = module;
                    $module
                        .data(moduleNamespace, instance)
                    ;
                },

                destroy: function () {
                    module.verbose('Destroying previous module for', element);
                    $module
                        .removeData(moduleNamespace)
                        .off(eventNamespace)
                    ;
                },

                bind: {
                    events: function () {
                        var
                            triggerEvent = module.get.event()
                        ;
                        if (triggerEvent) {
                            module.verbose('Attaching API events to element', triggerEvent);
                            $module
                                .on(triggerEvent + eventNamespace, module.event.trigger)
                            ;
                        } else if (settings.on === 'now') {
                            module.debug('Querying API endpoint immediately');
                            module.query();
                        }
                    },
                },

                decode: {
                    json: function (response) {
                        if (response !== undefined && typeof response === 'string') {
                            try {
                                response = JSON.parse(response);
                            } catch (e) {
                                // isn't json string
                            }
                        }

                        return response;
                    },
                },

                read: {
                    cachedResponse: function (url) {
                        var
                            response
                        ;
                        if (window.Storage === undefined) {
                            module.error(error.noStorage);

                            return;
                        }
                        response = sessionStorage.getItem(url + module.get.normalizedData());
                        module.debug('Using cached response', url, settings.data, response);
                        response = module.decode.json(response);

                        return response;
                    },
                },
                write: {
                    cachedResponse: function (url, response) {
                        if (window.Storage === undefined) {
                            module.error(error.noStorage);

                            return;
                        }
                        if ($.isPlainObject(response)) {
                            response = JSON.stringify(response);
                        }
                        sessionStorage.setItem(url + module.get.normalizedData(), response);
                        module.verbose('Storing cached response for url', url, settings.data, response);
                    },
                },

                query: function () {
                    if (module.is.disabled()) {
                        module.debug('Element is disabled API request aborted');

                        return;
                    }

                    if (module.is.loading()) {
                        if (settings.interruptRequests) {
                            module.debug('Interrupting previous request');
                            module.abort();
                        } else {
                            module.debug('Cancelling request, previous request is still pending');

                            return;
                        }
                    }

                    // pass element metadata to url (value, text)
                    if (settings.defaultData) {
                        $.extend(true, settings.urlData, module.get.defaultData());
                    }

                    // Add form content
                    if (settings.serializeForm) {
                        settings.data = module.add.formData(originalData || settings.data);
                    }

                    // call beforesend and get any settings changes
                    requestSettings = module.get.settings();

                    // check if before send cancelled request
                    if (requestSettings === false) {
                        module.cancelled = true;
                        module.error(error.beforeSend);

                        return;
                    }

                    module.cancelled = false;

                    // get url
                    url = module.get.templatedURL();

                    if (!url && !module.is.mocked()) {
                        module.error(error.missingURL);

                        return;
                    }

                    // replace variables
                    url = module.add.urlData(url);
                    // missing url parameters
                    if (!url && !module.is.mocked()) {
                        return;
                    }

                    requestSettings.url = settings.base + url;

                    // look for jQuery ajax parameters in settings
                    ajaxSettings = $.extend(true, {}, settings, {
                        type: settings.method || settings.type,
                        data: data,
                        url: settings.base + url,
                        beforeSend: settings.beforeXHR,
                        success: function () {},
                        failure: function () {},
                        complete: function () {},
                    });

                    module.debug('Querying URL', ajaxSettings.url);
                    module.verbose('Using AJAX settings', ajaxSettings);
                    if (settings.cache === 'local' && module.read.cachedResponse(url)) {
                        module.debug('Response returned from local cache');
                        module.request = module.create.request();
                        module.request.resolveWith(context, [module.read.cachedResponse(url)]);

                        return;
                    }

                    if (!settings.throttle) {
                        module.debug('Sending request', data, ajaxSettings.method);
                        module.send.request();
                    } else {
                        if (!settings.throttleFirstRequest && !module.timer) {
                            module.debug('Sending request', data, ajaxSettings.method);
                            module.send.request();
                            module.timer = setTimeout(function () {}, settings.throttle);
                        } else {
                            module.debug('Throttling request', settings.throttle);
                            clearTimeout(module.timer);
                            module.timer = setTimeout(function () {
                                if (module.timer) {
                                    delete module.timer;
                                }
                                module.debug('Sending throttled request', data, ajaxSettings.method);
                                module.send.request();
                            }, settings.throttle);
                        }
                    }
                },

                should: {
                    removeError: function () {
                        return settings.hideError === true || (settings.hideError === 'auto' && !module.is.form());
                    },
                },

                is: {
                    disabled: function () {
                        return $module.filter(selector.disabled).length > 0;
                    },
                    expectingJSON: function () {
                        return settings.dataType === 'json' || settings.dataType === 'jsonp';
                    },
                    form: function () {
                        return $module.is('form') || $context.is('form');
                    },
                    mocked: function () {
                        return settings.mockResponse || settings.mockResponseAsync || settings.response || settings.responseAsync;
                    },
                    input: function () {
                        return $module.is('input');
                    },
                    loading: function () {
                        return module.request
                            ? module.request.state() === 'pending'
                            : false;
                    },
                    abortedRequest: function (xhr) {
                        if (xhr && xhr.readyState !== undefined && xhr.readyState === 0) {
                            module.verbose('XHR request determined to be aborted');

                            return true;
                        }

                        module.verbose('XHR request was not aborted');

                        return false;
                    },
                    validResponse: function (response) {
                        if (!module.is.expectingJSON() || !isFunction(settings.successTest)) {
                            module.verbose('Response is not JSON, skipping validation', settings.successTest, response);

                            return true;
                        }
                        module.debug('Checking JSON returned success', settings.successTest, response);
                        if (settings.successTest(response)) {
                            module.debug('Response passed success test', response);

                            return true;
                        }

                        module.debug('Response failed success test', response);

                        return false;
                    },
                },

                was: {
                    cancelled: function () {
                        return module.cancelled || false;
                    },
                    successful: function () {
                        return module.request && module.request.state() === 'resolved';
                    },
                    failure: function () {
                        return module.request && module.request.state() === 'rejected';
                    },
                    complete: function () {
                        return module.request && (module.request.state() === 'resolved' || module.request.state() === 'rejected');
                    },
                },

                add: {
                    urlData: function (url, urlData) {
                        var
                            requiredVariables,
                            optionalVariables
                        ;
                        if (url) {
                            requiredVariables = url.match(regExp.required);
                            optionalVariables = url.match(regExp.optional);
                            urlData = urlData || settings.urlData;
                            if (requiredVariables) {
                                module.debug('Looking for required URL variables', requiredVariables);
                                $.each(requiredVariables, function (index, templatedString) {
                                    var
                                        // allow legacy {$var} style
                                        variable = templatedString.indexOf('$') !== -1
                                            ? templatedString.slice(2, -1)
                                            : templatedString.slice(1, -1),
                                        value   = $.isPlainObject(urlData) && urlData[variable] !== undefined
                                            ? urlData[variable]
                                            : ($module.data(variable) !== undefined
                                                ? $module.data(variable)
                                                : ($context.data(variable) !== undefined // eslint-disable-line unicorn/no-nested-ternary
                                                    ? $context.data(variable)
                                                    : urlData[variable]))
                                    ;
                                    // remove value
                                    if (value === undefined) {
                                        module.error(error.requiredParameter, variable, url);
                                        url = false;

                                        return false;
                                    }

                                    module.verbose('Found required variable', variable, value);
                                    value = settings.encodeParameters
                                        ? module.get.urlEncodedValue(value)
                                        : value;
                                    url = url.replace(templatedString, value);
                                });
                            }
                            if (optionalVariables) {
                                module.debug('Looking for optional URL variables', requiredVariables);
                                $.each(optionalVariables, function (index, templatedString) {
                                    var
                                        // allow legacy {/$var} style
                                        variable = templatedString.indexOf('$') !== -1
                                            ? templatedString.slice(3, -1)
                                            : templatedString.slice(2, -1),
                                        value   = $.isPlainObject(urlData) && urlData[variable] !== undefined
                                            ? urlData[variable]
                                            : ($module.data(variable) !== undefined
                                                ? $module.data(variable)
                                                : ($context.data(variable) !== undefined // eslint-disable-line unicorn/no-nested-ternary
                                                    ? $context.data(variable)
                                                    : urlData[variable]))
                                    ;
                                    // optional replacement
                                    if (value !== undefined) {
                                        module.verbose('Optional variable Found', variable, value);
                                        url = url.replace(templatedString, value);
                                    } else {
                                        module.verbose('Optional variable not found', variable);
                                        // remove preceding slash if set
                                        url = url.indexOf('/' + templatedString) !== -1
                                            ? url.replace('/' + templatedString, '')
                                            : url.replace(templatedString, '');
                                    }
                                });
                            }
                        }

                        return url;
                    },
                    formData: function (data) {
                        var
                            formData = {},
                            hasOtherData,
                            useFormDataApi = settings.serializeForm === 'formdata'
                        ;
                        data = data || originalData || settings.data;
                        hasOtherData = $.isPlainObject(data);

                        if (useFormDataApi) {
                            formData = new FormData($form[0]);
                            settings.processData = settings.processData !== undefined ? settings.processData : false;
                            settings.contentType = settings.contentType !== undefined ? settings.contentType : false;
                        } else {
                            var
                                formArray = $form.serializeArray(),
                                pushes = {},
                                pushValues = {},
                                build = function (base, key, value) {
                                    base[key] = value;

                                    return base;
                                }
                            ;
                            // add files
                            $.each($('input[type="file"]', $form), function (i, tag) {
                                $.each($(tag)[0].files, function (j, file) {
                                    formArray.push({ name: tag.name, value: file });
                                });
                            });
                            $.each(formArray, function (i, el) {
                                if (!regExp.validate.test(el.name)) {
                                    return;
                                }
                                var
                                    isCheckbox = $('[name="' + el.name + '"]', $form).attr('type') === 'checkbox',
                                    floatValue = parseFloat(el.value),
                                    value = (isCheckbox && el.value === 'on')
                                        || el.value === 'true'
                                        || (String(floatValue) === el.value
                                            ? floatValue
                                            : (el.value === 'false' ? false : el.value)),
                                    nameKeys = el.name.match(regExp.key) || [],
                                    pushKey = el.name.replace(/\[]$/, '')
                                ;
                                if (!(pushKey in pushes)) {
                                    pushes[pushKey] = 0;
                                    pushValues[pushKey] = value;
                                } else if (Array.isArray(pushValues[pushKey])) {
                                    pushValues[pushKey].push(value);
                                } else {
                                    pushValues[pushKey] = [pushValues[pushKey], value];
                                }
                                if (pushKey.indexOf('[]') === -1) {
                                    value = pushValues[pushKey];
                                }

                                while (nameKeys.length > 0) {
                                    var k = nameKeys.pop();

                                    if (k === '' && !Array.isArray(value)) { // foo[]
                                        value = build([], pushes[pushKey]++, value);
                                    } else if (regExp.fixed.test(k)) { // foo[n]
                                        value = build([], k, value);
                                    } else if (regExp.named.test(k)) { // foo; foo[bar]
                                        value = build({}, k, value);
                                    }
                                }
                                formData = $.extend(true, formData, value);
                            });
                        }

                        if (hasOtherData) {
                            module.debug('Extending existing data with form data', data, formData);
                            if (useFormDataApi) {
                                $.each(Object.keys(data), function (i, el) {
                                    formData.append(el, data[el]);
                                });
                                data = formData;
                            } else {
                                data = $.extend(true, {}, data, formData);
                            }
                        } else {
                            module.debug('Adding form data', formData);
                            data = formData;
                        }

                        return data;
                    },
                },

                send: {
                    request: function () {
                        module.set.loading();
                        module.request = module.create.request();
                        if (module.is.mocked()) {
                            module.mockedXHR = module.create.mockedXHR();
                        } else {
                            module.xhr = module.create.xhr();
                        }
                        settings.onRequest.call(context, module.request, module.xhr);
                    },
                },

                event: {
                    trigger: function (event) {
                        module.query();
                        if (event.type === 'submit' || event.type === 'click') {
                            event.preventDefault();
                        }
                    },
                    xhr: {
                        always: function () {
                            // nothing special
                        },
                        done: function (response, textStatus, xhr) {
                            var
                                context            = this,
                                elapsedTime        = Date.now() - requestStartTime,
                                timeLeft           = settings.loadingDuration - elapsedTime,
                                translatedResponse = isFunction(settings.onResponse)
                                    ? (module.is.expectingJSON() && !settings.rawResponse
                                        ? settings.onResponse.call(context, $.extend(true, {}, response))
                                        : settings.onResponse.call(context, response))
                                    : false
                            ;
                            timeLeft = timeLeft > 0
                                ? timeLeft
                                : 0;
                            if (translatedResponse) {
                                module.debug('Modified API response in onResponse callback', settings.onResponse, translatedResponse, response);
                                response = translatedResponse;
                            }
                            if (timeLeft > 0) {
                                module.debug('Response completed early delaying state change by', timeLeft);
                            }
                            setTimeout(function () {
                                if (module.is.validResponse(response)) {
                                    module.request.resolveWith(context, [response, xhr]);
                                } else {
                                    module.request.rejectWith(context, [xhr, 'invalid']);
                                }
                            }, timeLeft);
                        },
                        fail: function (xhr, status, httpMessage) {
                            var
                                context     = this,
                                elapsedTime = Date.now() - requestStartTime,
                                timeLeft    = settings.loadingDuration - elapsedTime
                            ;
                            timeLeft = timeLeft > 0
                                ? timeLeft
                                : 0;
                            if (timeLeft > 0) {
                                module.debug('Response completed early delaying state change by', timeLeft);
                            }
                            setTimeout(function () {
                                if (module.is.abortedRequest(xhr)) {
                                    module.request.rejectWith(context, [xhr, 'aborted', httpMessage]);
                                } else {
                                    module.request.rejectWith(context, [xhr, 'error', status, httpMessage]);
                                }
                            }, timeLeft);
                        },
                    },
                    request: {
                        done: function (response, xhr) {
                            module.debug('Successful API Response', response);
                            if (settings.cache === 'local' && url) {
                                module.write.cachedResponse(url, response);
                                module.debug('Saving server response locally', module.cache);
                            }
                            settings.onSuccess.call(context, response, $module, xhr);
                        },
                        complete: function (firstParameter, secondParameter) {
                            var
                                xhr,
                                response
                            ;
                            // have to guess callback parameters based on request success
                            if (module.was.successful()) {
                                response = firstParameter;
                                xhr = secondParameter;
                            } else {
                                xhr = firstParameter;
                                response = module.get.responseFromXHR(xhr);
                            }
                            module.remove.loading();
                            settings.onComplete.call(context, response, $module, xhr);
                        },
                        fail: function (xhr, status, httpMessage) {
                            var
                                // pull response from xhr if available
                                response     = module.get.responseFromXHR(xhr),
                                errorMessage = module.get.errorFromRequest(response, status, httpMessage)
                            ;
                            if (status === 'aborted') {
                                module.debug('XHR Aborted (Most likely caused by page navigation or CORS Policy)', status, httpMessage);
                                settings.onAbort.call(context, status, $module, xhr);

                                return true;
                            }
                            if (status === 'invalid') {
                                module.debug('JSON did not pass success test. A server-side error has most likely occurred', response);
                            } else if (status === 'error') {
                                if (xhr !== undefined) {
                                    module.debug('XHR produced a server error', status, httpMessage);
                                    // make sure we have an error to display to console
                                    if ((xhr.status < 200 || xhr.status >= 300) && httpMessage !== undefined && httpMessage !== '') {
                                        module.error(error.statusMessage + httpMessage, ajaxSettings.url);
                                    }
                                    settings.onError.call(context, errorMessage, $module, xhr);
                                }
                            }

                            if (settings.errorDuration && status !== 'aborted') {
                                module.debug('Adding error state');
                                module.set.error();
                                if (module.should.removeError()) {
                                    setTimeout(function () {
                                        module.remove.error();
                                    }, settings.errorDuration);
                                }
                            }
                            module.debug('API Request failed', errorMessage, xhr);
                            settings.onFailure.call(context, response, $module, xhr);
                        },
                    },
                },

                create: {

                    request: function () {
                        // api request promise
                        return $.Deferred()
                            .always(module.event.request.complete)
                            .done(module.event.request.done)
                            .fail(module.event.request.fail)
                        ;
                    },

                    mockedXHR: function () {
                        var
                            // xhr does not simulate these properties of xhr but must return them
                            textStatus     = false,
                            status         = false,
                            httpMessage    = false,
                            responder      = settings.mockResponse || settings.response,
                            asyncResponder = settings.mockResponseAsync || settings.responseAsync,
                            asyncCallback,
                            response,
                            mockedXHR
                        ;

                        mockedXHR = $.Deferred()
                            .always(module.event.xhr.complete)
                            .done(module.event.xhr.done)
                            .fail(module.event.xhr.fail)
                        ;

                        if (responder) {
                            if (isFunction(responder)) {
                                module.debug('Using specified synchronous callback', responder);
                                response = responder.call(context, requestSettings);
                            } else {
                                module.debug('Using settings specified response', responder);
                                response = responder;
                            }
                            // simulating response
                            mockedXHR.resolveWith(context, [response, textStatus, { responseText: response }]);
                        } else if (isFunction(asyncResponder)) {
                            asyncCallback = function (response) {
                                module.debug('Async callback returned response', response);

                                if (response) {
                                    mockedXHR.resolveWith(context, [response, textStatus, { responseText: response }]);
                                } else {
                                    mockedXHR.rejectWith(context, [{ responseText: response }, status, httpMessage]);
                                }
                            };
                            module.debug('Using specified async response callback', asyncResponder);
                            asyncResponder.call(context, requestSettings, asyncCallback);
                        }

                        return mockedXHR;
                    },

                    xhr: function () {
                        var
                            xhr
                        ;
                        // ajax request promise
                        xhr = $.ajax(ajaxSettings)
                            .always(module.event.xhr.always)
                            .done(module.event.xhr.done)
                            .fail(module.event.xhr.fail)
                        ;
                        module.verbose('Created server request', xhr, ajaxSettings);

                        return xhr;
                    },
                },

                set: {
                    error: function () {
                        module.verbose('Adding error state to element', $context);
                        $context.addClass(className.error);
                    },
                    loading: function () {
                        module.verbose('Adding loading state to element', $context);
                        $context.addClass(className.loading);
                        requestStartTime = Date.now();
                    },
                },

                remove: {
                    error: function () {
                        module.verbose('Removing error state from element', $context);
                        $context.removeClass(className.error);
                    },
                    loading: function () {
                        module.verbose('Removing loading state from element', $context);
                        $context.removeClass(className.loading);
                    },
                },

                get: {
                    normalizedData: function () {
                        return typeof settings.data === 'string' ? settings.data : JSON.stringify(settings.data, Object.keys(settings.data).sort());
                    },
                    responseFromXHR: function (xhr) {
                        return $.isPlainObject(xhr)
                            ? (module.is.expectingJSON()
                                ? module.decode.json(xhr.responseText)
                                : xhr.responseText)
                            : false;
                    },
                    errorFromRequest: function (response, status, httpMessage) {
                        return $.isPlainObject(response) && response.error !== undefined
                            ? response.error // use json error message
                            : (settings.error[status] !== undefined // use server error message
                                ? settings.error[status]
                                : httpMessage);
                    },
                    request: function () {
                        return module.request || false;
                    },
                    xhr: function () {
                        return module.xhr || false;
                    },
                    settings: function () {
                        var
                            runSettings
                        ;
                        runSettings = settings.beforeSend.call($module, settings);
                        if (runSettings) {
                            if (runSettings.success !== undefined) {
                                module.debug('Legacy success callback detected', runSettings);
                                module.error(error.legacyParameters, runSettings.success);
                                runSettings.onSuccess = runSettings.success;
                            }
                            if (runSettings.failure !== undefined) {
                                module.debug('Legacy failure callback detected', runSettings);
                                module.error(error.legacyParameters, runSettings.failure);
                                runSettings.onFailure = runSettings.failure;
                            }
                            if (runSettings.complete !== undefined) {
                                module.debug('Legacy complete callback detected', runSettings);
                                module.error(error.legacyParameters, runSettings.complete);
                                runSettings.onComplete = runSettings.complete;
                            }
                        }
                        if (runSettings === undefined) {
                            module.error(error.noReturnedValue);
                        }
                        if (runSettings === false) {
                            return runSettings;
                        }

                        return runSettings !== undefined
                            ? $.extend(true, {}, runSettings)
                            : $.extend(true, {}, settings);
                    },
                    urlEncodedValue: function (value) {
                        var
                            decodedValue   = window.decodeURIComponent(value),
                            encodedValue   = window.encodeURIComponent(value),
                            alreadyEncoded = decodedValue !== value
                        ;
                        if (alreadyEncoded) {
                            module.debug('URL value is already encoded, avoiding double encoding', value);

                            return value;
                        }
                        module.verbose('Encoding value using encodeURIComponent', value, encodedValue);

                        return encodedValue;
                    },
                    defaultData: function () {
                        var
                            data = {}
                        ;
                        if (!isWindow(element)) {
                            if (module.is.input()) {
                                data.value = $module.val();
                            } else if (!module.is.form()) {
                                data.text = $module.text();
                            }
                        }

                        return data;
                    },
                    event: function () {
                        if (isWindow(element) || settings.on === 'now') {
                            module.debug('API called without element, no events attached');

                            return false;
                        }
                        if (settings.on === 'auto') {
                            if ($module.is('input')) {
                                return element.oninput !== undefined
                                    ? 'input'
                                    : (element.onpropertychange !== undefined
                                        ? 'propertychange'
                                        : 'keyup');
                            }
                            if ($module.is('form')) {
                                return 'submit';
                            }

                            return 'click';
                        }

                        return settings.on;
                    },
                    templatedURL: function (action) {
                        action = action || settings.action || $module.data(metadata.action) || false;
                        url = settings.url || $module.data(metadata.url) || false;
                        if (url) {
                            module.debug('Using specified url', url);

                            return url;
                        }
                        if (action) {
                            module.debug('Looking up url for action', action, settings.api);
                            if (settings.api[action] === undefined && !module.is.mocked()) {
                                module.error(error.missingAction, settings.action, settings.api);

                                return;
                            }
                            url = settings.api[action];
                        } else if (module.is.form()) {
                            url = $module.attr('action') || $context.attr('action') || false;
                            module.debug('No url or action specified, defaulting to form action', url);
                        }

                        return url;
                    },
                },

                abort: function () {
                    var
                        xhr = module.get.xhr()
                    ;
                    if (xhr && xhr.state() !== 'resolved') {
                        module.debug('Cancelling API request');
                        xhr.abort();
                    }
                },

                // reset state
                reset: function () {
                    module.remove.error();
                    module.remove.loading();
                },

                setting: function (name, value) {
                    module.debug('Changing setting', name, value);
                    if ($.isPlainObject(name)) {
                        $.extend(true, settings, name);
                    } else if (value !== undefined) {
                        if ($.isPlainObject(settings[name])) {
                            $.extend(true, settings[name], value);
                        } else {
                            settings[name] = value;
                        }
                    } else {
                        return settings[name];
                    }
                },
                internal: function (name, value) {
                    if ($.isPlainObject(name)) {
                        $.extend(true, module, name);
                    } else if (value !== undefined) {
                        module[name] = value;
                    } else {
                        return module[name];
                    }
                },
                debug: function () {
                    if (!settings.silent && settings.debug) {
                        if (settings.performance) {
                            module.performance.log(arguments);
                        } else {
                            module.debug = Function.prototype.bind.call(console.info, console, settings.name + ':');
                            module.debug.apply(console, arguments);
                        }
                    }
                },
                verbose: function () {
                    if (!settings.silent && settings.verbose && settings.debug) {
                        if (settings.performance) {
                            module.performance.log(arguments);
                        } else {
                            module.verbose = Function.prototype.bind.call(console.info, console, settings.name + ':');
                            module.verbose.apply(console, arguments);
                        }
                    }
                },
                error: function () {
                    if (!settings.silent) {
                        module.error = Function.prototype.bind.call(console.error, console, settings.name + ':');
                        module.error.apply(console, arguments);
                    }
                },
                performance: {
                    log: function (message) {
                        var
                            currentTime,
                            executionTime,
                            previousTime
                        ;
                        if (settings.performance) {
                            currentTime = Date.now();
                            previousTime = time || currentTime;
                            executionTime = currentTime - previousTime;
                            time = currentTime;
                            performance.push({
                                Name: message[0],
                                Arguments: [].slice.call(message, 1) || '',
                                // 'Element'        : element,
                                'Execution Time': executionTime,
                            });
                        }
                        clearTimeout(module.performance.timer);
                        module.performance.timer = setTimeout(function () {
                            module.performance.display();
                        }, 500);
                    },
                    display: function () {
                        var
                            title = settings.name + ':',
                            totalTime = 0
                        ;
                        time = false;
                        clearTimeout(module.performance.timer);
                        $.each(performance, function (index, data) {
                            totalTime += data['Execution Time'];
                        });
                        title += ' ' + totalTime + 'ms';
                        if (performance.length > 0) {
                            console.groupCollapsed(title);
                            if (console.table) {
                                console.table(performance);
                            } else {
                                $.each(performance, function (index, data) {
                                    console.log(data.Name + ': ' + data['Execution Time'] + 'ms');
                                });
                            }
                            console.groupEnd();
                        }
                        performance = [];
                    },
                },
                invoke: function (query, passedArguments, context) {
                    var
                        object = instance,
                        maxDepth,
                        found,
                        response
                    ;
                    passedArguments = passedArguments || queryArguments;
                    context = context || element;
                    if (typeof query === 'string' && object !== undefined) {
                        query = query.split(/[ .]/);
                        maxDepth = query.length - 1;
                        $.each(query, function (depth, value) {
                            var camelCaseValue = depth !== maxDepth
                                ? value + query[depth + 1].charAt(0).toUpperCase() + query[depth + 1].slice(1)
                                : query
                            ;
                            if ($.isPlainObject(object[camelCaseValue]) && (depth !== maxDepth)) {
                                object = object[camelCaseValue];
                            } else if (object[camelCaseValue] !== undefined) {
                                found = object[camelCaseValue];

                                return false;
                            } else if ($.isPlainObject(object[value]) && (depth !== maxDepth)) {
                                object = object[value];
                            } else if (object[value] !== undefined) {
                                found = object[value];

                                return false;
                            } else {
                                module.error(error.method, query);

                                return false;
                            }
                        });
                    }
                    if (isFunction(found)) {
                        response = found.apply(context, passedArguments);
                    } else if (found !== undefined) {
                        response = found;
                    }
                    if (Array.isArray(returnedValue)) {
                        returnedValue.push(response);
                    } else if (returnedValue !== undefined) {
                        returnedValue = [returnedValue, response];
                    } else if (response !== undefined) {
                        returnedValue = response;
                    }

                    return found;
                },
            };

            if (methodInvoked) {
                if (instance === undefined) {
                    module.initialize();
                }
                module.invoke(query);
            } else {
                if (instance !== undefined) {
                    instance.invoke('destroy');
                }
                module.initialize();
            }
        });

        return returnedValue !== undefined
            ? returnedValue
            : this;
    };
    $.api = $.fn.api;

    $.api.settings = {

        name: 'API',
        namespace: 'api',

        debug: false,
        verbose: false,
        performance: true,

        // object containing all templates endpoints
        api: {},

        // whether to cache responses
        cache: true,

        // whether new requests should abort previous requests
        interruptRequests: true,

        // event binding
        on: 'auto',

        // context for applying state classes
        stateContext: false,

        // duration for loading state
        loadingDuration: 0,

        // whether to hide errors after a period of time
        hideError: 'auto',

        // duration for error state
        errorDuration: 2000,

        // whether parameters should be encoded with encodeURIComponent
        encodeParameters: true,

        // API action to use
        action: false,

        // templated URL to use
        url: false,

        // base URL to apply to all endpoints
        base: '',

        // data that will
        urlData: {},

        // whether to add default data to url data
        defaultData: true,

        // whether to serialize closest form
        // use true to convert complex named keys like a[b][1][c][] into a nested object
        // use 'formdata' for formdata web api
        serializeForm: false,

        // how long to wait before request should occur
        throttle: 0,

        // whether to throttle first request or only repeated
        throttleFirstRequest: true,

        // standard ajax settings
        method: 'get',
        data: {},
        dataType: 'json',

        // mock response
        mockResponse: false,
        mockResponseAsync: false,

        // aliases for mock
        response: false,
        responseAsync: false,

        // whether onResponse should work with response value without force converting into an object
        rawResponse: true,

        // callbacks before request
        beforeSend: function (settings) {
            return settings;
        },
        beforeXHR: function (xhr) {},
        onRequest: function (promise, xhr) {},

        // after request
        onResponse: false, // function(response) { },

        // response was successful, if JSON passed validation
        onSuccess: function (response, $module) {},

        // request finished without aborting
        onComplete: function (response, $module) {},

        // failed JSON success test
        onFailure: function (response, $module) {},

        // server error
        onError: function (errorMessage, $module) {},

        // request aborted
        onAbort: function (errorMessage, $module) {},

        successTest: false,

        // errors
        error: {
            beforeSend: 'The before send function has aborted the request',
            error: 'There was an error with your request',
            exitConditions: 'API Request Aborted. Exit conditions met',
            JSONParse: 'JSON could not be parsed during error handling',
            legacyParameters: 'You are using legacy API success callback names',
            method: 'The method you called is not defined',
            missingAction: 'API action used but no url was defined',
            missingURL: 'No URL specified for api event',
            noReturnedValue: 'The beforeSend callback must return a settings object, beforeSend ignored.',
            noStorage: 'Caching responses locally requires session storage',
            parseError: 'There was an error parsing your request',
            requiredParameter: 'Missing a required URL parameter: ',
            statusMessage: 'Server gave an error: ',
            timeout: 'Your request timed out',
        },

        regExp: {
            required: /{\$*[\da-z]+}/gi,
            optional: /{\/\$*[\da-z]+}/gi,
            validate: /^[_a-z][\w-]*(?:\[[\w-]*])*$/i,
            key: /[\w-]+|(?=\[])/gi,
            push: /^$/,
            fixed: /^\d+$/,
            named: /^[\w-]+$/i,
        },

        className: {
            loading: 'loading',
            error: 'error',
        },

        selector: {
            disabled: '.disabled',
            form: 'form',
        },

        metadata: {
            action: 'action',
            url: 'url',
        },
    };
})(jQuery, window, document);

/*!
 * # Fomantic-UI 2.9.4 - Dropdown
 * https://github.com/fomantic/Fomantic-UI/
 *
 *
 * Released under the MIT license
 * https://opensource.org/licenses/MIT
 *
 */

(function ($, window, document) {
    'use strict';

    function isFunction(obj) {
        return typeof obj === 'function' && typeof obj.nodeType !== 'number';
    }

    window = window !== undefined && window.Math === Math
        ? window
        : globalThis;

    $.fn.dropdown = function (parameters) {
        var
            $allModules    = $(this),
            $document      = $(document),

            time           = Date.now(),
            performance    = [],

            query          = arguments[0],
            methodInvoked  = typeof query === 'string',
            queryArguments = [].slice.call(arguments, 1),
            contextCheck   = function (context, win) {
                var $context;
                if ([window, document].indexOf(context) >= 0) {
                    $context = $(context);
                } else {
                    $context = $(win.document).find(context);
                    if ($context.length === 0) {
                        $context = win.frameElement ? contextCheck(context, win.parent) : window;
                    }
                }

                return $context;
            },
            returnedValue
        ;

        $allModules.each(function (elementIndex) {
            var
                settings          = $.isPlainObject(parameters)
                    ? $.extend(true, {}, $.fn.dropdown.settings, parameters)
                    : $.extend({}, $.fn.dropdown.settings),

                className       = settings.className,
                message         = settings.message,
                fields          = settings.fields,
                keys            = settings.keys,
                metadata        = settings.metadata,
                namespace       = settings.namespace,
                regExp          = settings.regExp,
                selector        = settings.selector,
                error           = settings.error,
                templates       = settings.templates,

                eventNamespace  = '.' + namespace,
                moduleNamespace = 'module-' + namespace,

                $module         = $(this),
                $context        = contextCheck(settings.context, window),
                $text           = $module.find(selector.text),
                $search         = $module.find(selector.search),
                $sizer          = $module.find(selector.sizer),
                $input          = $module.find(selector.input),
                $icon           = $module.find(selector.icon),
                $clear          = $module.find(selector.clearIcon),

                $combo = $module.prev().find(selector.text).length > 0
                    ? $module.prev().find(selector.text)
                    : $module.prev(),

                $menu           = $module.children(selector.menu),
                $item           = $menu.find(selector.item),
                $divider        = settings.hideDividers
                    ? $item.parent().children(selector.divider)
                    : $(),

                activated       = false,
                itemActivated   = false,
                internalChange  = false,
                iconClicked     = false,
                element         = this,
                focused         = false,
                instance        = $module.data(moduleNamespace),

                selectActionActive,
                initialLoad,
                pageLostFocus,
                willRefocus,
                elementNamespace,
                id,
                selectObserver,
                menuObserver,
                classObserver,
                module,
                tempDisableApiCache = false
            ;

            module = {

                initialize: function () {
                    module.debug('Initializing dropdown', settings);

                    if (module.is.alreadySetup()) {
                        module.setup.reference();
                    } else {
                        if (settings.ignoreDiacritics && !String.prototype.normalize) {
                            settings.ignoreDiacritics = false;
                            module.error(error.noNormalize, element);
                        }

                        module.create.id();
                        module.setup.layout();

                        if (settings.values) {
                            module.set.initialLoad();
                            module.change.values(settings.values);
                            module.remove.initialLoad();
                        }
                        if (module.get.placeholderText() !== '') {
                            module.set.placeholderText();
                        }

                        module.refreshData();

                        module.save.defaults();
                        module.restore.selected();

                        module.bind.events();

                        module.observeChanges();
                        module.instantiate();
                    }
                },

                instantiate: function () {
                    module.verbose('Storing instance of dropdown', module);
                    instance = module;
                    $module
                        .data(moduleNamespace, module)
                    ;
                },

                destroy: function () {
                    module.verbose('Destroying previous dropdown', $module);
                    module.remove.tabbable();
                    module.remove.active();
                    $menu.transition('stop all');
                    $menu.removeClass(className.visible).addClass(className.hidden);
                    $module
                        .off(eventNamespace)
                        .removeData(moduleNamespace)
                    ;
                    $menu
                        .off(eventNamespace)
                    ;
                    $document
                        .off(elementNamespace)
                    ;
                    module.disconnect.menuObserver();
                    module.disconnect.selectObserver();
                    module.disconnect.classObserver();
                },

                observeChanges: function () {
                    if ('MutationObserver' in window) {
                        selectObserver = new MutationObserver(module.event.select.mutation);
                        menuObserver = new MutationObserver(module.event.menu.mutation);
                        classObserver = new MutationObserver(module.event.class.mutation);
                        module.debug('Setting up mutation observer', selectObserver, menuObserver, classObserver);
                        module.observe.select();
                        module.observe.menu();
                        module.observe.class();
                    }
                },

                disconnect: {
                    menuObserver: function () {
                        if (menuObserver) {
                            menuObserver.disconnect();
                        }
                    },
                    selectObserver: function () {
                        if (selectObserver) {
                            selectObserver.disconnect();
                        }
                    },
                    classObserver: function () {
                        if (classObserver) {
                            classObserver.disconnect();
                        }
                    },
                },
                observe: {
                    select: function () {
                        if (module.has.input() && selectObserver) {
                            selectObserver.observe($module[0], {
                                attributes: true,
                                childList: true,
                                subtree: true,
                            });
                        }
                    },
                    menu: function () {
                        if (module.has.menu() && menuObserver) {
                            menuObserver.observe($menu[0], {
                                childList: true,
                                subtree: true,
                            });
                        }
                    },
                    class: function () {
                        if (module.has.search() && classObserver) {
                            classObserver.observe($module[0], {
                                attributes: true,
                            });
                        }
                    },
                },

                create: {
                    id: function () {
                        id = (Math.random().toString(16) + '000000000').slice(2, 10);
                        elementNamespace = '.' + id;
                        module.verbose('Creating unique id for element', id);
                    },
                    userChoice: function (values) {
                        var
                            $userChoices,
                            $userChoice,
                            html
                        ;
                        values = values || module.get.userValues();
                        if (!values) {
                            return false;
                        }
                        values = Array.isArray(values)
                            ? values
                            : [values];
                        $.each(values, function (index, value) {
                            if (module.get.item(value) === false) {
                                html = settings.templates.addition(module.add.variables(message.addResult, value));
                                $userChoice = $('<div />')
                                    .html(html)
                                    .attr('data-' + metadata.value, value)
                                    .attr('data-' + metadata.text, value)
                                    .addClass(className.addition)
                                    .addClass(className.item)
                                ;
                                if (settings.hideAdditions) {
                                    $userChoice.addClass(className.hidden);
                                }
                                $userChoices = $userChoices === undefined
                                    ? $userChoice
                                    : $userChoices.add($userChoice);
                                module.verbose('Creating user choices for value', value, $userChoice);
                            }
                        });

                        return $userChoices;
                    },
                    userLabels: function (value) {
                        var
                            userValues = module.get.userValues()
                        ;
                        if (userValues) {
                            module.debug('Adding user labels', userValues);
                            $.each(userValues, function (index, value) {
                                module.verbose('Adding custom user value');
                                module.add.label(value, value);
                            });
                        }
                    },
                    menu: function () {
                        $menu = $('<div />')
                            .addClass(className.menu)
                            .appendTo($module)
                        ;
                    },
                    sizer: function () {
                        $sizer = $('<span />')
                            .addClass(className.sizer)
                            .insertAfter($search)
                        ;
                    },
                },

                search: function (query) {
                    query = query !== undefined
                        ? query
                        : module.get.query();
                    module.verbose('Searching for query', query);
                    if (settings.fireOnInit === false && module.is.initialLoad()) {
                        module.verbose('Skipping callback on initial load', settings.onSearch);
                    } else if (module.has.minCharacters(query) && settings.onSearch.call(element, query) !== false) {
                        module.filter(query);
                    } else {
                        module.hide(null, true);
                    }
                },

                select: {
                    firstUnfiltered: function () {
                        module.verbose('Selecting first non-filtered element');
                        module.remove.selectedItem();
                        $item
                            .not(selector.unselectable)
                            .not(selector.addition + selector.hidden)
                            .eq(0)
                            .addClass(className.selected)
                        ;
                    },
                    nextAvailable: function ($selected) {
                        $selected = $selected.eq(0);
                        var
                            $nextAvailable = $selected.nextAll(selector.item).not(selector.unselectable).eq(0),
                            $prevAvailable = $selected.prevAll(selector.item).not(selector.unselectable).eq(0),
                            hasNext        = $nextAvailable.length > 0
                        ;
                        if (hasNext) {
                            module.verbose('Moving selection to', $nextAvailable);
                            $nextAvailable.addClass(className.selected);
                        } else {
                            module.verbose('Moving selection to', $prevAvailable);
                            $prevAvailable.addClass(className.selected);
                        }
                    },
                },

                setup: {
                    api: function () {
                        var
                            apiSettings = {
                                debug: settings.debug,
                                urlData: {
                                    value: module.get.value(),
                                    query: module.get.query(),
                                },
                                on: false,
                            }
                        ;
                        module.verbose('First request, initializing API');
                        $module
                            .api(apiSettings)
                        ;
                    },
                    layout: function () {
                        if ($module.is('select')) {
                            module.setup.select();
                            module.setup.returnedObject();
                        }
                        if (!module.has.menu()) {
                            module.create.menu();
                        }
                        if (module.is.clearable() && !module.has.clearItem()) {
                            module.verbose('Adding clear icon');
                            $clear = $('<i />')
                                .addClass('remove icon')
                                .insertAfter($icon)
                            ;
                        }
                        if (module.is.search() && !module.has.search()) {
                            module.verbose('Adding search input');
                            var
                                labelNode = $module.prev('label')
                            ;
                            $search = $('<input />')
                                .addClass(className.search)
                                .prop('autocomplete', module.is.chrome() ? 'fomantic-search' : 'off')
                            ;
                            if (labelNode.length > 0) {
                                if (!labelNode.attr('id')) {
                                    labelNode.attr('id', '_' + module.get.id() + '_formLabel');
                                }
                                $search.attr('aria-labelledby', labelNode.attr('id'));
                            }
                            $search.insertBefore($text);
                        }
                        if (module.is.multiple() && module.is.searchSelection() && !module.has.sizer()) {
                            module.create.sizer();
                        }
                        if (settings.allowTab) {
                            module.set.tabbable();
                        }
                    },
                    select: function () {
                        var
                            selectValues  = module.get.selectValues()
                        ;
                        module.debug('Dropdown initialized on a select', selectValues);
                        if ($module.is('select')) {
                            $input = $module;
                        }
                        // see if select is placed correctly already
                        if ($input.parent(selector.dropdown).length > 0) {
                            module.debug('UI dropdown already exists. Creating dropdown menu only');
                            $module = $input.closest(selector.dropdown);
                            if (!module.has.menu()) {
                                module.create.menu();
                            }
                            $menu = $module.children(selector.menu);
                            module.setup.menu(selectValues);
                        } else {
                            module.debug('Creating entire dropdown from select');
                            $module = $('<div />')
                                .attr('class', $input.attr('class'))
                                .addClass(className.selection)
                                .addClass(className.dropdown)
                                .html(templates.dropdown(selectValues, fields, settings.preserveHTML, settings.className))
                                .insertBefore($input)
                            ;
                            if ($input.hasClass(className.multiple) && $input.prop('multiple') === false) {
                                module.error(error.missingMultiple);
                                $input.prop('multiple', true);
                            }
                            if ($input.is('[multiple]')) {
                                module.set.multiple();
                            }
                            if ($input.prop('disabled')) {
                                module.debug('Disabling dropdown');
                                $module.addClass(className.disabled);
                            }
                            if ($input.is('[required]')) {
                                settings.forceSelection = true;
                            }
                            if (!settings.allowTab) {
                                $input.removeAttr('tabindex');
                            }
                            $input
                                .prop('required', false)
                                .removeAttr('class')
                                .detach()
                                .prependTo($module)
                            ;
                        }
                        module.refresh();
                    },
                    menu: function (values) {
                        $menu.html(templates.menu(values, fields, settings.preserveHTML, settings.className));
                        $item = $menu.find(selector.item);
                        $divider = settings.hideDividers ? $item.parent().children(selector.divider) : $();
                    },
                    reference: function () {
                        module.debug('Dropdown behavior was called on select, replacing with closest dropdown');
                        // replace module reference
                        $module = $module.parent(selector.dropdown);
                        instance = $module.data(moduleNamespace);
                        element = $module[0];
                        module.refresh();
                        module.setup.returnedObject();
                    },
                    returnedObject: function () {
                        var
                            $firstModules = $allModules.slice(0, elementIndex),
                            $lastModules  = $allModules.slice(elementIndex + 1)
                        ;
                        // adjust all modules to use correct reference
                        $allModules = $firstModules.add($module).add($lastModules);
                    },
                },

                refresh: function () {
                    module.refreshSelectors();
                    module.refreshData();
                },

                refreshItems: function () {
                    $item = $menu.find(selector.item);
                    $divider = settings.hideDividers ? $item.parent().children(selector.divider) : $();
                },

                refreshSelectors: function () {
                    module.verbose('Refreshing selector cache');
                    $text = $module.find(selector.text);
                    $search = $module.find(selector.search);
                    $input = $module.find(selector.input);
                    $icon = $module.find(selector.icon);
                    $combo = $module.prev().find(selector.text).length > 0
                        ? $module.prev().find(selector.text)
                        : $module.prev();
                    $menu = $module.children(selector.menu);
                    $item = $menu.find(selector.item);
                    $divider = settings.hideDividers ? $item.parent().children(selector.divider) : $();
                },

                refreshData: function () {
                    module.verbose('Refreshing cached metadata');
                    $item
                        .removeData(metadata.text)
                        .removeData(metadata.value)
                    ;
                },

                clearData: function () {
                    module.verbose('Clearing metadata');
                    $item
                        .removeData(metadata.text)
                        .removeData(metadata.value)
                    ;
                    $module
                        .removeData(metadata.defaultText)
                        .removeData(metadata.defaultValue)
                        .removeData(metadata.placeholderText)
                    ;
                },

                clearItems: function () {
                    $menu.empty();
                    module.refreshItems();
                },

                toggle: function () {
                    module.verbose('Toggling menu visibility');
                    if (!module.is.active()) {
                        module.show();
                    } else {
                        module.hide();
                    }
                },

                show: function (callback, preventFocus) {
                    callback = isFunction(callback)
                        ? callback
                        : function () {};
                    if ((focused || iconClicked) && module.is.remote() && module.is.noApiCache() && !module.has.maxSelections()) {
                        module.clearItems();
                    }
                    if (!module.can.show() && module.is.remote()) {
                        module.debug('No API results retrieved, searching before show');
                        module.queryRemote(module.get.query(), module.show, [callback, preventFocus]);
                    }
                    if (module.can.show() && !module.is.active()) {
                        module.debug('Showing dropdown');
                        if (module.has.message() && !(module.has.maxSelections() || module.has.allResultsFiltered())) {
                            module.remove.message();
                        }
                        if (module.is.allFiltered()) {
                            return true;
                        }
                        if (settings.onShow.call(element) !== false) {
                            module.remove.empty();
                            module.animate.show(function () {
                                module.bind.intent();
                                if (module.has.search() && !preventFocus) {
                                    module.focusSearch();
                                }
                                module.set.visible();
                                callback.call(element);
                            });
                        }
                    }
                },

                hide: function (callback, preventBlur) {
                    callback = isFunction(callback)
                        ? callback
                        : function () {};
                    if (module.is.active() && !module.is.animatingOutward()) {
                        module.debug('Hiding dropdown');
                        if (settings.onHide.call(element) !== false) {
                            module.animate.hide(function () {
                                module.remove.visible();
                                // hiding search focus
                                if (module.is.focusedOnSearch() && preventBlur !== true) {
                                    $search.trigger('blur');
                                }
                                callback.call(element);
                            });
                            // Hide submenus explicitly. On some browsers (esp. mobile), they will not automatically receive a
                            // mouseleave event
                            var $subMenu = $module.find(selector.menu);
                            if ($subMenu.length > 0) {
                                module.verbose('Hiding sub-menu', $subMenu);
                                $subMenu.each(function () {
                                    var $sub = $(this);
                                    if (!module.is.animating($sub)) {
                                        module.animate.hide(false, $sub);
                                    }
                                });
                            }
                        }
                    } else {
                        module.unbind.intent();
                    }
                    iconClicked = false;
                    focused = false;
                },

                hideOthers: function () {
                    module.verbose('Finding other dropdowns to hide');
                    $allModules
                        .not($module)
                        .has(selector.menu + '.' + className.visible)
                        .dropdown('hide')
                    ;
                },

                hideMenu: function () {
                    module.verbose('Hiding menu  instantaneously');
                    module.remove.active();
                    module.remove.visible();
                    $menu.transition('destroy').transition('hide');
                },

                hideSubMenus: function () {
                    var
                        $subMenus = $menu.children(selector.item).find(selector.menu)
                    ;
                    module.verbose('Hiding sub menus', $subMenus);
                    $subMenus.transition('hide');
                },

                bind: {
                    events: function () {
                        module.bind.keyboardEvents();
                        module.bind.inputEvents();
                        module.bind.mouseEvents();
                    },
                    keyboardEvents: function () {
                        module.verbose('Binding keyboard events');
                        $module
                            .on('keydown' + eventNamespace, module.event.keydown)
                        ;
                        if (module.has.search()) {
                            $module
                                .on(module.get.inputEvent() + eventNamespace, selector.search, module.event.input)
                            ;
                        }
                        if (module.is.multiple()) {
                            $document
                                .on('keydown' + elementNamespace, module.event.document.keydown)
                            ;
                        }
                    },
                    inputEvents: function () {
                        module.verbose('Binding input change events');
                        $module
                            .on('change' + eventNamespace, selector.input, module.event.change)
                        ;
                        if (module.is.multiple() && module.is.searchSelection()) {
                            $module
                                .on('paste' + eventNamespace, selector.search, module.event.paste)
                            ;
                        }
                    },
                    mouseEvents: function () {
                        module.verbose('Binding mouse events');
                        if (module.is.multiple()) {
                            $module
                                .on('click' + eventNamespace, selector.label, module.event.label.click)
                                .on('click' + eventNamespace, selector.remove, module.event.remove.click)
                            ;
                        }
                        if (module.is.searchSelection()) {
                            $module
                                .on('mousedown' + eventNamespace, module.event.mousedown)
                                .on('mouseup' + eventNamespace, module.event.mouseup)
                                .on('mousedown' + eventNamespace, selector.menu, module.event.menu.mousedown)
                                .on('mouseup' + eventNamespace, selector.menu, module.event.menu.mouseup)
                                .on('click' + eventNamespace, selector.icon, module.event.icon.click)
                                .on('click' + eventNamespace, selector.clearIcon, module.event.clearIcon.click)
                                .on('focus' + eventNamespace, selector.search, module.event.search.focus)
                                .on('click' + eventNamespace, selector.search, module.event.search.focus)
                                .on('blur' + eventNamespace, selector.search, module.event.search.blur)
                                .on('click' + eventNamespace, selector.text, module.event.text.focus)
                            ;
                            if (module.is.multiple()) {
                                $module
                                    .on('click' + eventNamespace, module.event.click)
                                    .on('click' + eventNamespace, module.event.search.focus)
                                ;
                            }
                        } else {
                            if (settings.on === 'click') {
                                $module
                                    .on('click' + eventNamespace, selector.icon, module.event.icon.click)
                                    .on('click' + eventNamespace, module.event.test.toggle)
                                ;
                            } else if (settings.on === 'hover') {
                                $module
                                    .on('mouseenter' + eventNamespace, module.delay.show)
                                    .on('mouseleave' + eventNamespace, module.delay.hide)
                                    .on('touchstart' + eventNamespace, module.event.test.toggle)
                                    .on('touchstart' + eventNamespace, selector.icon, module.event.icon.click)
                                ;
                            } else {
                                $module
                                    .on(settings.on + eventNamespace, module.toggle)
                                ;
                            }
                            $module
                                .on('mousedown' + eventNamespace, module.event.mousedown)
                                .on('mouseup' + eventNamespace, module.event.mouseup)
                                .on('focus' + eventNamespace, module.event.focus)
                                .on('click' + eventNamespace, selector.clearIcon, module.event.clearIcon.click)
                            ;
                            if (module.has.menuSearch()) {
                                $module
                                    .on('blur' + eventNamespace, selector.search, module.event.search.blur)
                                ;
                            } else {
                                $module
                                    .on('blur' + eventNamespace, module.event.blur)
                                ;
                            }
                        }
                        $menu
                            .on('mouseenter' + eventNamespace, selector.item, module.event.item.mouseenter)
                            .on('touchstart' + eventNamespace, selector.item, module.event.item.mouseenter)
                            .on('mouseleave' + eventNamespace, selector.item, module.event.item.mouseleave)
                            .on('click' + eventNamespace, selector.item, module.event.item.click)
                        ;
                    },
                    intent: function () {
                        module.verbose('Binding hide intent event to document');
                        $document
                            .on('click' + elementNamespace, module.event.test.hide)
                        ;
                    },
                },

                unbind: {
                    intent: function () {
                        module.verbose('Removing hide intent event from document');
                        $document
                            .off('click' + elementNamespace)
                        ;
                    },
                },

                filter: function (query) {
                    var
                        searchTerm = query !== undefined
                            ? query
                            : module.get.query(),
                        afterFiltered = function () {
                            if (module.is.multiple()) {
                                module.filterActive();
                            }
                            if (query || (!query && module.get.activeItem().length === 0)) {
                                module.select.firstUnfiltered();
                            }
                            if (module.has.allResultsFiltered()) {
                                if (settings.onNoResults.call(element, searchTerm)) {
                                    if (settings.allowAdditions) {
                                        if (settings.hideAdditions) {
                                            module.verbose('User addition with no menu, setting empty style');
                                            module.set.empty();
                                            module.hideMenu();
                                        }
                                    } else {
                                        module.verbose('All items filtered, showing message', searchTerm);
                                        module.add.message(message.noResults);
                                    }
                                } else {
                                    module.verbose('All items filtered, hiding dropdown', searchTerm);
                                    module.set.empty();
                                    module.hideMenu();
                                }
                            } else {
                                module.remove.empty();
                                module.remove.message();
                            }
                            if (settings.allowAdditions) {
                                module.add.userSuggestion(module.escape.htmlEntities(query));
                            }
                            if (module.is.searchSelection() && module.can.show() && module.is.focusedOnSearch() && !module.is.empty()) {
                                module.show();
                            }
                        }
                    ;
                    if (settings.useLabels && module.has.maxSelections()) {
                        module.show();

                        return;
                    }
                    if (settings.apiSettings) {
                        if (module.can.useAPI()) {
                            module.queryRemote(searchTerm, function () {
                                if (settings.filterRemoteData) {
                                    module.filterItems(searchTerm);
                                }
                                var preSelected = $input.val();
                                if (!Array.isArray(preSelected)) {
                                    preSelected = preSelected && preSelected !== '' ? preSelected.split(settings.delimiter) : [];
                                }
                                if (module.is.multiple()) {
                                    $.each(preSelected, function (index, value) {
                                        $item.filter('[data-' + metadata.value + '="' + value + '"]')
                                            .addClass(className.filtered)
                                        ;
                                    });
                                }
                                module.focusSearch(true);
                                afterFiltered();
                            });
                        } else {
                            module.error(error.noAPI);
                        }
                    } else {
                        module.filterItems(searchTerm);
                        afterFiltered();
                    }
                },

                queryRemote: function (query, callback, callbackParameters) {
                    if (!Array.isArray(callbackParameters)) {
                        callbackParameters = [callbackParameters];
                    }
                    var
                        apiSettings = {
                            errorDuration: false,
                            cache: 'local',
                            throttle: settings.throttle,
                            urlData: {
                                query: query,
                            },
                        },
                        apiCallbacks = {
                            onError: function (errorMessage, $module, xhr) {
                                module.add.message(message.serverError);
                                iconClicked = false;
                                focused = false;
                                callback.apply(null, callbackParameters);
                                if (typeof settings.apiSettings.onError === 'function') {
                                    settings.apiSettings.onError.call(this, errorMessage, $module, xhr);
                                }
                            },
                            onFailure: function (response, $module, xhr) {
                                module.add.message(message.serverError);
                                iconClicked = false;
                                focused = false;
                                callback.apply(null, callbackParameters);
                                if (typeof settings.apiSettings.onFailure === 'function') {
                                    settings.apiSettings.onFailure.call(this, response, $module, xhr);
                                }
                            },
                            onSuccess: function (response, $module, xhr) {
                                var
                                    values          = response[fields.remoteValues]
                                ;
                                if (!Array.isArray(values)) {
                                    values = [];
                                }
                                module.remove.message();
                                var menuConfig = {};
                                menuConfig[fields.values] = values;
                                module.setup.menu(menuConfig);

                                if (values.length === 0 && !settings.allowAdditions) {
                                    module.add.message(message.noResults);
                                } else {
                                    var value = module.is.multiple() ? module.get.values() : module.get.value();
                                    if (value !== '') {
                                        module.verbose('Value(s) present after click icon, select value(s) in items');
                                        module.set.selected(value, null, true, true);
                                    }
                                }
                                iconClicked = false;
                                focused = false;
                                callback.apply(null, callbackParameters);
                                if (typeof settings.apiSettings.onSuccess === 'function') {
                                    settings.apiSettings.onSuccess.call(this, response, $module, xhr);
                                }
                            },
                        }
                    ;
                    if (!$module.api('get request')) {
                        module.setup.api();
                    }
                    apiSettings = $.extend(true, {}, apiSettings, settings.apiSettings, apiCallbacks, tempDisableApiCache ? { cache: false } : {});
                    $module
                        .api('setting', apiSettings)
                        .api('query')
                    ;
                    tempDisableApiCache = false;
                },

                filterItems: function (query) {
                    var
                        searchTerm = module.remove.diacritics(
                            query !== undefined
                                ? query
                                : module.get.query()
                        ),
                        results = null,
                        escapedTerm = module.escape.string(searchTerm),
                        regExpIgnore = settings.ignoreSearchCase ? 'i' : '',
                        regExpFlags = regExpIgnore + 'gm',
                        beginsWithRegExp = new RegExp('^' + escapedTerm, regExpFlags)
                    ;
                    module.remove.filteredItem();
                    // avoid loop if we're matching nothing
                    if (module.has.query()) {
                        results = [];

                        module.verbose('Searching for matching values', searchTerm);
                        $item
                            .each(function () {
                                var
                                    $choice = $(this),
                                    text,
                                    value
                                ;
                                if ($choice.hasClass(className.unfilterable)) {
                                    results.push(this);

                                    return true;
                                }
                                if (settings.match === 'both' || settings.match === 'text') {
                                    text = module.remove.diacritics(String(module.get.choiceText($choice, false)));
                                    if (text.search(beginsWithRegExp) !== -1
                                        || (settings.fullTextSearch === 'exact' && module.exactSearch(searchTerm, text))
                                        || (settings.fullTextSearch === true && module.fuzzySearch(searchTerm, text))
                                    ) {
                                        results.push(this);

                                        return true;
                                    }
                                }
                                if (settings.match === 'both' || settings.match === 'value') {
                                    value = module.remove.diacritics(String(module.get.choiceValue($choice, text)));
                                    if (value.search(beginsWithRegExp) !== -1
                                        || (settings.fullTextSearch === 'exact' && module.exactSearch(searchTerm, value))
                                        || (settings.fullTextSearch === true && module.fuzzySearch(searchTerm, value))
                                    ) {
                                        results.push(this);

                                        return true;
                                    }
                                }
                            })
                        ;
                    }
                    module.debug('Showing only matched items', searchTerm);
                    if (results) {
                        $item
                            .not(results)
                            .addClass(className.filtered)
                        ;
                        if (settings.highlightMatches && (settings.match === 'both' || settings.match === 'text')) {
                            var querySplit = query.split(''),
                                diacriticReg = settings.ignoreDiacritics ? '[\u0300-\u036F]?' : '',
                                htmlReg = '(?![^<]*>)',
                                markedRegExp = new RegExp(htmlReg + '(' + querySplit.join(diacriticReg + ')(.*?)' + htmlReg + '(') + diacriticReg + ')', regExpIgnore),
                                markedReplacer = function () {
                                    var args = [].slice.call(arguments, 1, querySplit.length * 2).map(function (x, i) {
                                        return i & 1 ? x : '<mark>' + x + '</mark>'; // eslint-disable-line no-bitwise
                                    });

                                    return args.join('');
                                }
                            ;
                            $.each(results, function (index, result) {
                                var $result = $(result),
                                    markedHTML = module.get.choiceText($result, true)
                                ;
                                if (settings.ignoreDiacritics) {
                                    markedHTML = markedHTML.normalize('NFD');
                                }
                                $result.html(markedHTML.replace(markedRegExp, markedReplacer));
                            });
                        }
                    }

                    if (!module.has.query()) {
                        $divider
                            .removeClass(className.hidden)
                        ;
                    } else if (settings.hideDividers === true) {
                        $divider
                            .addClass(className.hidden)
                        ;
                    } else if (settings.hideDividers === 'empty') {
                        $divider
                            .removeClass(className.hidden)
                            .filter(function () {
                                // First find the last divider in this divider group
                                // Dividers which are direct siblings are considered a group
                                var $lastDivider = $(this).nextUntil(selector.item);

                                return ($lastDivider.length > 0 ? $lastDivider : $(this))
                                    // Count all non-filtered items until the next divider (or end of the dropdown)
                                    .nextUntil(selector.divider)
                                    .filter(selector.item + ':not(.' + className.filtered + ')')
                                    // Hide divider if no items are found
                                    .length === 0;
                            })
                            .addClass(className.hidden)
                        ;
                    }
                },

                fuzzySearch: function (query, term) {
                    var
                        termLength  = term.length,
                        queryLength = query.length
                    ;
                    if (settings.ignoreSearchCase) {
                        query = query.toLowerCase();
                        term = term.toLowerCase();
                    }
                    if (queryLength > termLength) {
                        return false;
                    }
                    if (queryLength === termLength) {
                        return query === term;
                    }
                    for (var characterIndex = 0, nextCharacterIndex = 0; characterIndex < queryLength; characterIndex++) {
                        var
                            continueSearch = false,
                            queryCharacter = query.charCodeAt(characterIndex)
                        ;
                        while (nextCharacterIndex < termLength) {
                            if (term.charCodeAt(nextCharacterIndex++) === queryCharacter) {
                                continueSearch = true;

                                break;
                            }
                        }

                        if (!continueSearch) {
                            return false;
                        }
                    }

                    return true;
                },
                exactSearch: function (query, term) {
                    query = settings.ignoreSearchCase ? query.toLowerCase() : query;
                    term = settings.ignoreSearchCase ? term.toLowerCase() : term;

                    return term.indexOf(query) > -1;
                },
                filterActive: function () {
                    if (settings.useLabels) {
                        $item.filter('.' + className.active)
                            .addClass(className.filtered)
                        ;
                    }
                },

                focusSearch: function (skipHandler) {
                    if (module.has.search() && !module.is.focusedOnSearch()) {
                        if (skipHandler) {
                            $module.off('focus' + eventNamespace, selector.search);
                            $search.trigger('focus');
                            $module.on('focus' + eventNamespace, selector.search, module.event.search.focus);
                        } else {
                            $search.trigger('focus');
                        }
                    }
                },

                blurSearch: function () {
                    if (module.has.search()) {
                        $search.trigger('blur');
                    }
                },

                forceSelection: function () {
                    var
                        $currentlySelected = $item.not(className.filtered).filter('.' + className.selected).eq(0),
                        $activeItem        = $item.not(className.filtered).filter('.' + className.active).eq(0),
                        $selectedItem      = $currentlySelected.length > 0
                            ? $currentlySelected
                            : $activeItem,
                        hasSelected = $selectedItem.length > 0
                    ;
                    if (settings.allowAdditions || (hasSelected && !module.is.multiple())) {
                        module.debug('Forcing partial selection to selected item', $selectedItem);
                        module.event.item.click.call($selectedItem, {}, true);
                    } else {
                        module.remove.searchTerm();
                    }
                },

                change: {
                    values: function (values) {
                        if (!settings.allowAdditions) {
                            module.clear();
                        }
                        module.debug('Creating dropdown with specified values', values);
                        var menuConfig = {};
                        menuConfig[fields.values] = values;
                        module.setup.menu(menuConfig);
                        $.each(values, function (index, item) {
                            if (item.selected === true) {
                                module.debug('Setting initial selection to', item[fields.value]);
                                module.set.selected(item[fields.value]);
                                if (!module.is.multiple()) {
                                    return false;
                                }
                            }
                        });

                        if (module.has.selectInput()) {
                            module.disconnect.selectObserver();
                            $input.html('');
                            $input.append('<option disabled selected value></option>');
                            $.each(values, function (index, item) {
                                var
                                    value = settings.templates.deQuote(item[fields.value]),
                                    name = settings.templates.escape(
                                        item[fields.name] || '',
                                        settings.preserveHTML
                                    )
                                ;
                                $input.append('<option value="' + value + '"' + (item.selected === true ? ' selected' : '') + '>' + name + '</option>');
                            });
                            module.observe.select();
                        }
                    },
                },

                event: {
                    paste: function (event) {
                        var
                            pasteValue = (event.originalEvent.clipboardData || window.clipboardData).getData('text'),
                            tokens = pasteValue.split(settings.delimiter),
                            notFoundTokens = []
                        ;
                        tokens.forEach(function (value) {
                            if (module.set.selected(module.escape.htmlEntities(value.trim()), null, false, true) === false) {
                                notFoundTokens.push(value.trim());
                            }
                        });
                        event.preventDefault();
                        if (notFoundTokens.length > 0) {
                            var searchEl = $search[0],
                                startPos = searchEl.selectionStart,
                                endPos = searchEl.selectionEnd,
                                orgText = searchEl.value,
                                pasteText = notFoundTokens.join(settings.delimiter),
                                newEndPos = startPos + pasteText.length
                            ;
                            $search.val(orgText.slice(0, startPos) + pasteText + orgText.slice(endPos));
                            searchEl.selectionStart = newEndPos;
                            searchEl.selectionEnd = newEndPos;
                            module.event.input(event);
                        }
                    },
                    change: function () {
                        if (!internalChange) {
                            module.debug('Input changed, updating selection');
                            module.set.selected();
                        }
                    },
                    focus: function () {
                        if (settings.showOnFocus && !activated && module.is.hidden() && !pageLostFocus) {
                            focused = true;
                            module.show();
                        }
                    },
                    blur: function (event) {
                        pageLostFocus = document.activeElement === this;
                        if (!activated && !pageLostFocus) {
                            module.remove.activeLabel();
                            module.hide();
                        }
                    },
                    mousedown: function () {
                        if (module.is.searchSelection(true)) {
                            // prevent menu hiding on immediate re-focus
                            willRefocus = true;
                        } else {
                            // prevents focus callback from occurring on mousedown
                            activated = true;
                        }
                    },
                    mouseup: function () {
                        if (module.is.searchSelection(true)) {
                            // prevent menu hiding on immediate re-focus
                            willRefocus = false;
                        } else {
                            activated = false;
                        }
                    },
                    click: function (event) {
                        var
                            $target = $(event.target)
                        ;
                        // focus search
                        if ($target.is($module)) {
                            if (!module.is.focusedOnSearch()) {
                                module.focusSearch();
                            } else {
                                module.show();
                            }
                        }
                    },
                    search: {
                        focus: function (event) {
                            activated = true;
                            if (module.is.multiple()) {
                                module.remove.activeLabel();
                            }
                            if (!focused && !module.is.active() && (settings.showOnFocus || (event.type !== 'focus' && event.type !== 'focusin')) && event.type !== 'touchstart') {
                                focused = true;
                                module.search();
                            }
                        },
                        blur: function (event) {
                            pageLostFocus = document.activeElement === this;
                            if (module.is.searchSelection(true) && !willRefocus) {
                                if (!itemActivated && !pageLostFocus) {
                                    if (settings.forceSelection) {
                                        module.forceSelection();
                                    } else if (!settings.allowAdditions && !settings.keepSearchTerm && !module.has.menuSearch()) {
                                        module.remove.searchTerm();
                                    }
                                    module.hide();
                                }
                            }
                            willRefocus = false;
                        },
                    },
                    clearIcon: {
                        click: function (event) {
                            module.clear();
                            if (module.is.searchSelection()) {
                                module.remove.searchTerm();
                            }
                            if (settings.collapseOnClearable) {
                                module.hide();
                            }
                            event.stopPropagation();
                        },
                    },
                    icon: {
                        click: function (event) {
                            iconClicked = true;
                            if (module.has.search()) {
                                if (!module.is.active()) {
                                    if (settings.showOnFocus) {
                                        module.focusSearch();
                                    } else {
                                        module.toggle();
                                    }
                                } else {
                                    module.blurSearch();
                                }
                            } else {
                                module.toggle();
                            }
                            event.stopPropagation();
                        },
                    },
                    text: {
                        focus: function (event) {
                            activated = true;
                            module.focusSearch();
                        },
                    },
                    input: function (event) {
                        if (module.is.multiple() || module.is.searchSelection()) {
                            module.set.filtered();
                        }
                        clearTimeout(module.timer);
                        module.timer = setTimeout(function () {
                            module.search();
                        }, settings.delay.search);
                    },
                    label: {
                        click: function (event) {
                            var
                                $label        = $(this),
                                $labels       = $module.find(selector.label),
                                $activeLabels = $labels.filter('.' + className.active),
                                $nextActive   = $label.nextAll('.' + className.active),
                                $prevActive   = $label.prevAll('.' + className.active),
                                $range = $nextActive.length > 0
                                    ? $label.nextUntil($nextActive).add($activeLabels).add($label)
                                    : $label.prevUntil($prevActive).add($activeLabels).add($label)
                            ;
                            if (event.shiftKey) {
                                $activeLabels.removeClass(className.active);
                                $range.addClass(className.active);
                            } else if (event.ctrlKey) {
                                $label.toggleClass(className.active);
                            } else {
                                $activeLabels.removeClass(className.active);
                                $label.addClass(className.active);
                            }
                            settings.onLabelSelect.apply(this, $labels.filter('.' + className.active));
                            event.stopPropagation();
                        },
                    },
                    remove: {
                        click: function (event) {
                            var
                                $label = $(this).parent()
                            ;
                            if ($label.hasClass(className.active)) {
                                // remove all selected labels
                                module.remove.activeLabels();
                            } else {
                                // remove this label only
                                module.remove.activeLabels($label);
                            }
                            event.stopPropagation();
                        },
                    },
                    test: {
                        toggle: function (event) {
                            var
                                toggleBehavior = module.is.multiple()
                                    ? module.show
                                    : module.toggle
                            ;
                            if (module.is.bubbledLabelClick(event) || module.is.bubbledIconClick(event)) {
                                return;
                            }
                            if (!module.is.multiple() || (module.is.multiple() && !module.is.active())) {
                                focused = true;
                            }
                            if (module.determine.eventOnElement(event, toggleBehavior) && event.type !== 'touchstart') {
                                // do not preventDefault of touchstart; so emulated mouseenter is triggered on first touch and not later
                                // (when selecting an item). The double-showing of the dropdown through both events does not hurt.
                                event.preventDefault();
                            }
                        },
                        hide: function (event) {
                            if (module.determine.eventInModule(event, module.hide)) {
                                if (element.id && $(event.target).attr('for') === element.id) {
                                    event.preventDefault();
                                }
                            }
                        },
                    },
                    class: {
                        mutation: function (mutations) {
                            mutations.forEach(function (mutation) {
                                if (mutation.attributeName === 'class') {
                                    module.check.disabled();
                                }
                            });
                        },
                    },
                    select: {
                        mutation: function (mutations) {
                            if (module.is.selectMutation(mutations)) {
                                module.debug('<select> modified, recreating menu');
                                module.disconnect.selectObserver();
                                module.refresh();
                                module.setup.select();
                                module.set.selected();
                                module.observe.select();
                            }
                        },
                    },
                    menu: {
                        mutation: function (mutations) {
                            var
                                mutation   = mutations[0],
                                $addedNode = mutation.addedNodes
                                    ? $(mutation.addedNodes[0])
                                    : $(false),
                                $removedNode = mutation.removedNodes
                                    ? $(mutation.removedNodes[0])
                                    : $(false),
                                $changedNodes  = $addedNode.add($removedNode),
                                isUserAddition = $changedNodes.is(selector.addition) || $changedNodes.closest(selector.addition).length > 0,
                                isMessage      = $changedNodes.is(selector.message) || $changedNodes.closest(selector.message).length > 0
                            ;
                            if (isUserAddition || isMessage) {
                                module.debug('Updating item selector cache');
                                module.refreshItems();
                            } else {
                                module.debug('Menu modified, updating selector cache');
                                module.refresh();
                            }
                        },
                        mousedown: function () {
                            itemActivated = true;
                        },
                        mouseup: function () {
                            itemActivated = false;
                        },
                    },
                    item: {
                        mouseenter: function (event) {
                            var
                                $target        = $(event.target),
                                $item          = $(this),
                                $subMenu       = $item.children(selector.menu),
                                $otherMenus    = $item.siblings(selector.item).children(selector.menu),
                                hasSubMenu     = $subMenu.length > 0,
                                isBubbledEvent = $subMenu.find($target).length > 0
                            ;
                            if (!isBubbledEvent && hasSubMenu) {
                                clearTimeout(module.itemTimer);
                                module.itemTimer = setTimeout(function () {
                                    module.verbose('Showing sub-menu', $subMenu);
                                    $.each($otherMenus, function () {
                                        module.animate.hide(false, $(this));
                                    });
                                    module.animate.show(false, $subMenu);
                                }, settings.delay.show);
                                event.preventDefault();
                            }
                        },
                        mouseleave: function (event) {
                            var
                                $subMenu = $(this).find(selector.menu)
                            ;
                            if ($subMenu.length > 0) {
                                clearTimeout(module.itemTimer);
                                module.itemTimer = setTimeout(function () {
                                    module.verbose('Hiding sub-menu', $subMenu);
                                    $subMenu.each(function () {
                                        module.animate.hide(false, $(this));
                                    });
                                }, settings.delay.hide);
                            }
                        },
                        click: function (event, skipRefocus) {
                            var
                                $choice        = $(this),
                                $target        = event
                                    ? $(event.target || '')
                                    : $(''),
                                $subMenu       = $choice.find(selector.menu),
                                text           = module.get.choiceText($choice),
                                value          = module.get.choiceValue($choice, text),
                                hasSubMenu     = $subMenu.length > 0,
                                isBubbledEvent = $subMenu.find($target).length > 0
                            ;
                            // prevents IE11 bug where menu receives focus even though `tabindex=-1`
                            if (document.activeElement.tagName.toLowerCase() !== 'input') {
                                $(document.activeElement).trigger('blur');
                            }
                            if (!isBubbledEvent && (!hasSubMenu || settings.allowCategorySelection)) {
                                if (module.is.searchSelection()) {
                                    if (settings.allowAdditions) {
                                        module.remove.userAddition();
                                    }
                                    if (!settings.keepSearchTerm) {
                                        if (module.is.multiple()) {
                                            module.remove.filteredItem();
                                        }
                                        module.remove.searchTerm();
                                    }
                                    if (!module.is.visible() && $target.length > 0) {
                                        module.show();
                                    }
                                    if (!module.is.focusedOnSearch() && skipRefocus !== true) {
                                        module.focusSearch(true);
                                    }
                                }
                                if (!settings.useLabels) {
                                    module.remove.filteredItem();
                                    module.set.scrollPosition($choice);
                                }
                                module.determine.selectAction.call(this, text, value);
                            }
                        },
                    },

                    document: {
                        // label selection should occur even when element has no focus
                        keydown: function (event) {
                            var
                                pressedKey    = event.which,
                                isShortcutKey = module.is.inObject(pressedKey, keys)
                            ;
                            if (isShortcutKey) {
                                var
                                    $label            = $module.find(selector.label),
                                    $activeLabel      = $label.filter('.' + className.active),
                                    activeValue       = $activeLabel.data(metadata.value),
                                    labelIndex        = $label.index($activeLabel),
                                    labelCount        = $label.length,
                                    hasActiveLabel    = $activeLabel.length > 0,
                                    hasMultipleActive = $activeLabel.length > 1,
                                    isFirstLabel      = labelIndex === 0,
                                    isLastLabel       = labelIndex + 1 === labelCount,
                                    isSearch          = module.is.searchSelection(),
                                    isFocusedOnSearch = module.is.focusedOnSearch(),
                                    isFocused         = module.is.focused(),
                                    caretAtStart      = isFocusedOnSearch && module.get.caretPosition(false) === 0,
                                    isSelectedSearch  = caretAtStart && module.get.caretPosition(true) !== 0
                                ;
                                if (isSearch && !hasActiveLabel && !isFocusedOnSearch) {
                                    return;
                                }

                                switch (pressedKey) {
                                    case keys.leftArrow: {
                                        // activate previous label
                                        if ((isFocused || caretAtStart) && !hasActiveLabel) {
                                            module.verbose('Selecting previous label');
                                            $label.last().addClass(className.active);
                                        } else if (hasActiveLabel) {
                                            if (!event.shiftKey) {
                                                module.verbose('Selecting previous label');
                                                $label.removeClass(className.active);
                                            } else {
                                                module.verbose('Adding previous label to selection');
                                            }
                                            if (isFirstLabel && !hasMultipleActive) {
                                                $activeLabel.addClass(className.active);
                                            } else {
                                                $activeLabel.prev(selector.siblingLabel)
                                                    .addClass(className.active)
                                                    .end()
                                                ;
                                            }
                                            event.preventDefault();
                                        }

                                        break;
                                    }
                                    case keys.rightArrow: {
                                        // activate first label
                                        if (isFocused && !hasActiveLabel) {
                                            $label.first().addClass(className.active);
                                        }
                                        // activate next label
                                        if (hasActiveLabel) {
                                            if (!event.shiftKey) {
                                                module.verbose('Selecting next label');
                                                $label.removeClass(className.active);
                                            } else {
                                                module.verbose('Adding next label to selection');
                                            }
                                            if (isLastLabel) {
                                                if (isSearch) {
                                                    if (!isFocusedOnSearch) {
                                                        module.focusSearch();
                                                    } else {
                                                        $label.removeClass(className.active);
                                                    }
                                                } else if (hasMultipleActive) {
                                                    $activeLabel.next(selector.siblingLabel).addClass(className.active);
                                                } else {
                                                    $activeLabel.addClass(className.active);
                                                }
                                            } else {
                                                $activeLabel.next(selector.siblingLabel).addClass(className.active);
                                            }
                                            event.preventDefault();
                                        }

                                        break;
                                    }
                                    case keys.deleteKey:
                                    case keys.backspace: {
                                        if (hasActiveLabel) {
                                            module.verbose('Removing active labels');
                                            if (isLastLabel) {
                                                if (isSearch && !isFocusedOnSearch) {
                                                    module.focusSearch();
                                                }
                                            }
                                            $activeLabel.last().next(selector.siblingLabel).addClass(className.active);
                                            module.remove.activeLabels($activeLabel);
                                            if (!module.is.visible()) {
                                                module.show();
                                            }
                                            event.preventDefault();
                                        } else if (caretAtStart && !isSelectedSearch && !hasActiveLabel && pressedKey === keys.backspace) {
                                            module.verbose('Removing last label on input backspace');
                                            $activeLabel = $label.last().addClass(className.active);
                                            module.remove.activeLabels($activeLabel);
                                            if (!module.is.visible()) {
                                                module.show();
                                            }
                                        }

                                        break;
                                    }
                                    default: {
                                        $activeLabel.removeClass(className.active);
                                    }
                                }
                            }
                        },
                    },

                    keydown: function (event) {
                        var
                            pressedKey    = event.which,
                            isShortcutKey = module.is.inObject(pressedKey, keys) || event.key === settings.delimiter
                        ;
                        if (isShortcutKey) {
                            var
                                $currentlySelected = $item.not(selector.unselectable).filter('.' + className.selected).eq(0),
                                $activeItem        = $menu.children('.' + className.active).eq(0),
                                $selectedItem      = $currentlySelected.length > 0
                                    ? $currentlySelected
                                    : $activeItem,
                                $visibleItems = $selectedItem.length > 0
                                    ? $selectedItem.siblings(':not(.' + className.filtered + ')').addBack()
                                    : $menu.children(':not(.' + className.filtered + ')'),
                                $subMenu              = $selectedItem.children(selector.menu),
                                $parentMenu           = $selectedItem.closest(selector.menu),
                                inVisibleMenu         = $parentMenu.hasClass(className.visible) || $parentMenu.hasClass(className.animating) || $parentMenu.parent(selector.menu).length > 0,
                                hasSubMenu            = $subMenu.length > 0,
                                hasSelectedItem       = $selectedItem.length > 0,
                                selectedIsSelectable  = $selectedItem.not(selector.unselectable).length > 0,
                                delimiterPressed      = event.key === settings.delimiter && module.is.multiple(),
                                isAdditionWithoutMenu = settings.allowAdditions && (pressedKey === keys.enter || delimiterPressed),
                                $nextItem,
                                isSubMenuItem
                            ;
                            // allow selection with menu closed
                            if (isAdditionWithoutMenu) {
                                if (selectedIsSelectable && settings.hideAdditions) {
                                    module.verbose('Selecting item from keyboard shortcut', $selectedItem);
                                    module.event.item.click.call($selectedItem, event);
                                }
                                if (module.is.searchSelection() && !settings.keepSearchTerm) {
                                    module.remove.searchTerm();
                                }
                                if (module.is.multiple()) {
                                    event.preventDefault();
                                }
                            }

                            // visible menu keyboard shortcuts
                            if (module.is.visible()) {
                                // enter (select or open sub-menu)
                                if (pressedKey === keys.enter || delimiterPressed) {
                                    if (pressedKey === keys.enter && hasSelectedItem && hasSubMenu && !settings.allowCategorySelection) {
                                        module.verbose('Pressed enter on unselectable category, opening sub menu');
                                        pressedKey = keys.rightArrow;
                                    } else if (selectedIsSelectable) {
                                        module.verbose('Selecting item from keyboard shortcut', $selectedItem);
                                        module.event.item.click.call($selectedItem, event);
                                        if (module.is.searchSelection()) {
                                            if (!settings.keepSearchTerm) {
                                                module.remove.searchTerm();
                                            }
                                            if (module.is.multiple()) {
                                                $search.trigger('focus');
                                            }
                                        }
                                    }
                                    event.preventDefault();
                                }

                                // sub-menu actions
                                if (hasSelectedItem) {
                                    if (pressedKey === keys.leftArrow) {
                                        isSubMenuItem = $parentMenu[0] !== $menu[0];

                                        if (isSubMenuItem) {
                                            module.verbose('Left key pressed, closing sub-menu');
                                            module.animate.hide(false, $parentMenu);
                                            $selectedItem
                                                .removeClass(className.selected)
                                            ;
                                            $parentMenu
                                                .closest(selector.item)
                                                .addClass(className.selected)
                                            ;
                                            event.preventDefault();
                                        }
                                    }

                                    // right arrow (show sub-menu)
                                    if (pressedKey === keys.rightArrow) {
                                        if (hasSubMenu) {
                                            module.verbose('Right key pressed, opening sub-menu');
                                            module.animate.show(false, $subMenu);
                                            $selectedItem
                                                .removeClass(className.selected)
                                            ;
                                            $subMenu
                                                .find(selector.item).eq(0)
                                                .addClass(className.selected)
                                            ;
                                            event.preventDefault();
                                        }
                                    }
                                }

                                // up arrow (traverse menu up)
                                if (pressedKey === keys.upArrow) {
                                    $nextItem = hasSelectedItem && inVisibleMenu
                                        ? $selectedItem.prevAll(selector.item + ':not(' + selector.unselectable + ')').eq(0)
                                        : $item.eq(0);
                                    if ($visibleItems.index($nextItem) < 0) {
                                        module.verbose('Up key pressed but reached top of current menu');
                                        event.preventDefault();

                                        return;
                                    }

                                    module.verbose('Up key pressed, changing active item');
                                    $selectedItem
                                        .removeClass(className.selected)
                                    ;
                                    $nextItem
                                        .addClass(className.selected)
                                    ;
                                    module.set.scrollPosition($nextItem);
                                    if (settings.selectOnKeydown && module.is.single() && !$nextItem.hasClass(className.actionable)) {
                                        module.set.selectedItem($nextItem);
                                    }

                                    event.preventDefault();
                                }

                                // down arrow (traverse menu down)
                                if (pressedKey === keys.downArrow) {
                                    $nextItem = hasSelectedItem && inVisibleMenu
                                        ? $selectedItem.nextAll(selector.item + ':not(' + selector.unselectable + ')').eq(0)
                                        : $item.eq(0);
                                    if ($nextItem.length === 0) {
                                        module.verbose('Down key pressed but reached bottom of current menu');
                                        event.preventDefault();

                                        return;
                                    }

                                    module.verbose('Down key pressed, changing active item');
                                    $item
                                        .removeClass(className.selected)
                                    ;
                                    $nextItem
                                        .addClass(className.selected)
                                    ;
                                    module.set.scrollPosition($nextItem);
                                    if (settings.selectOnKeydown && module.is.single() && !$nextItem.hasClass(className.actionable)) {
                                        module.set.selectedItem($nextItem);
                                    }

                                    event.preventDefault();
                                }

                                // page down (show next page)
                                if (pressedKey === keys.pageUp) {
                                    module.scrollPage('up');
                                    event.preventDefault();
                                }
                                if (pressedKey === keys.pageDown) {
                                    module.scrollPage('down');
                                    event.preventDefault();
                                }

                                // escape (close menu)
                                if (pressedKey === keys.escape) {
                                    module.verbose('Escape key pressed, closing dropdown');
                                    module.hide();
                                    event.stopPropagation();
                                }
                            } else {
                                // delimiter key
                                if (pressedKey === keys.enter || delimiterPressed) {
                                    event.preventDefault();
                                }
                                // down arrow (open menu)
                                if (pressedKey === keys.downArrow && !module.is.visible()) {
                                    module.verbose('Down key pressed, showing dropdown');
                                    module.show();
                                    event.preventDefault();
                                }
                            }
                        } else {
                            if (!module.has.search()) {
                                module.set.selectedLetter(String.fromCharCode(pressedKey));
                            }
                        }
                    },
                },

                trigger: {
                    change: function () {
                        var
                            inputElement = $input[0]
                        ;
                        if (inputElement) {
                            var events = document.createEvent('HTMLEvents');
                            module.verbose('Triggering native change event');
                            events.initEvent('change', true, false);
                            inputElement.dispatchEvent(events);
                        }
                    },
                },

                determine: {
                    selectAction: function (text, value) {
                        selectActionActive = true;
                        module.verbose('Determining action', settings.action);
                        if (isFunction(module.action[settings.action])) {
                            module.verbose('Triggering preset action', settings.action, text, value);
                            module.action[settings.action].call(element, text, value, this);
                        } else if (isFunction(settings.action)) {
                            module.verbose('Triggering user action', settings.action, text, value);
                            settings.action.call(element, text, value, this);
                        } else {
                            module.error(error.action, settings.action);
                        }
                        selectActionActive = false;
                    },
                    eventInModule: function (event, callback) {
                        var
                            $target    = $(event.target),
                            inDocument = $target.closest(document.documentElement).length > 0,
                            inModule   = $target.closest($module).length > 0
                        ;
                        callback = isFunction(callback)
                            ? callback
                            : function () {};
                        if (inDocument && !inModule) {
                            module.verbose('Triggering event', callback);
                            callback();

                            return true;
                        }

                        module.verbose('Event occurred in dropdown, canceling callback');

                        return false;
                    },
                    eventOnElement: function (event, callback) {
                        var
                            $target      = $(event.target),
                            $label       = $target.closest(selector.siblingLabel),
                            inVisibleDOM = document.body.contains(event.target),
                            notOnLabel   = $module.find($label).length === 0 || !(module.is.multiple() && settings.useLabels),
                            notInMenu    = $target.closest($menu).length === 0
                        ;
                        callback = isFunction(callback)
                            ? callback
                            : function () {};
                        if (inVisibleDOM && notOnLabel && notInMenu) {
                            module.verbose('Triggering event', callback);
                            callback();

                            return true;
                        }

                        module.verbose('Event occurred in dropdown menu, canceling callback');

                        return false;
                    },
                },

                action: {

                    nothing: function () {},

                    activate: function (text, value, element) {
                        value = value !== undefined
                            ? value
                            : text;
                        if (module.can.activate($(element))) {
                            module.set.selected(value, $(element), false, settings.keepSearchTerm);
                            if (!module.is.multiple() && !(!settings.collapseOnActionable && $(element).hasClass(className.actionable))) {
                                module.hideAndClear();
                            }
                        }
                    },

                    select: function (text, value, element) {
                        value = value !== undefined
                            ? value
                            : text;
                        if (module.can.activate($(element))) {
                            module.set.value(value, text, $(element));
                            if (!module.is.multiple() && !(!settings.collapseOnActionable && $(element).hasClass(className.actionable))) {
                                module.hideAndClear();
                            }
                        }
                    },

                    combo: function (text, value, element) {
                        value = value !== undefined
                            ? value
                            : text;
                        module.set.selected(value, $(element));
                        module.hideAndClear();
                    },

                    hide: function (text, value, element) {
                        module.set.value(value, text, $(element));
                        module.hideAndClear();
                    },

                },

                get: {
                    id: function () {
                        return id;
                    },
                    defaultText: function () {
                        return $module.data(metadata.defaultText);
                    },
                    defaultValue: function () {
                        return $module.data(metadata.defaultValue);
                    },
                    placeholderText: function () {
                        if (settings.placeholder !== 'auto' && typeof settings.placeholder === 'string') {
                            return settings.placeholder;
                        }

                        return $module.data(metadata.placeholderText) || '';
                    },
                    text: function () {
                        return settings.preserveHTML ? $text.html() : $text.text();
                    },
                    query: function () {
                        return String($search.val()).trim();
                    },
                    searchWidth: function (value) {
                        value = value !== undefined
                            ? value
                            : $search.val();
                        $sizer.text(value);

                        // prevent rounding issues
                        return Math.ceil($sizer.width() + (module.is.edge() ? 3 : 1));
                    },
                    selectionCount: function () {
                        var
                            values = module.get.values(),
                            count
                        ;
                        count = module.is.multiple()
                            ? (Array.isArray(values) ? values.length : 0)
                            : (module.get.value() !== '' ? 1 : 0);

                        return count;
                    },
                    transition: function ($subMenu) {
                        return settings.transition === 'auto'
                            ? (module.is.upward($subMenu) ? 'slide up' : 'slide down')
                            : settings.transition;
                    },
                    userValues: function () {
                        var
                            values = module.get.values(true)
                        ;
                        if (!values) {
                            return false;
                        }
                        values = Array.isArray(values)
                            ? values
                            : [values];

                        return $.grep(values, function (value) {
                            return module.get.item(value) === false;
                        });
                    },
                    uniqueArray: function (array) {
                        return $.grep(array, function (value, index) {
                            return $.inArray(value, array) === index;
                        });
                    },
                    caretPosition: function (returnEndPos) {
                        var
                            input = $search[0],
                            range,
                            rangeLength
                        ;
                        if (returnEndPos && 'selectionEnd' in input) {
                            return input.selectionEnd;
                        }
                        if (!returnEndPos && 'selectionStart' in input) {
                            return input.selectionStart;
                        }
                        if (document.selection) {
                            input.focus();
                            range = document.selection.createRange();
                            rangeLength = range.text.length;
                            if (returnEndPos) {
                                return rangeLength;
                            }
                            range.moveStart('character', -input.value.length);

                            return range.text.length - rangeLength;
                        }
                    },
                    value: function () {
                        var
                            value = $input.length > 0
                                ? $input.val()
                                : $module.data(metadata.value),
                            isEmptyMultiselect = Array.isArray(value) && value.length === 1 && value[0] === ''
                        ;

                        // prevents placeholder element from being selected when multiple
                        return value === undefined || isEmptyMultiselect
                            ? ''
                            : value;
                    },
                    values: function (raw) {
                        var
                            value = module.get.value()
                        ;
                        if (value === '') {
                            return '';
                        }

                        return !module.has.selectInput() && module.is.multiple()
                            ? (typeof value === 'string' // delimited string
                                ? (raw
                                    ? value
                                    : module.escape.htmlEntities(value)).split(settings.delimiter)
                                : '')
                            : value;
                    },
                    remoteValues: function () {
                        var
                            values = module.get.values(),
                            remoteValues = false
                        ;
                        if (values) {
                            if (typeof values === 'string') {
                                values = [values];
                            }
                            $.each(values, function (index, value) {
                                var
                                    name = module.read.remoteData(value)
                                ;
                                module.verbose('Restoring value from session data', name, value);
                                if (name) {
                                    if (!remoteValues) {
                                        remoteValues = {};
                                    }
                                    remoteValues[value] = name;
                                }
                            });
                        }

                        return remoteValues;
                    },
                    choiceText: function ($choice, preserveHTML) {
                        preserveHTML = preserveHTML !== undefined
                            ? preserveHTML
                            : settings.preserveHTML;
                        if ($choice) {
                            if ($choice.find(selector.menu).length > 0) {
                                module.verbose('Retrieving text of element with sub-menu');
                                $choice = $choice.clone();
                                $choice.find(selector.menu).remove();
                                $choice.find(selector.menuIcon).remove();
                            }

                            return $choice.data(metadata.text) !== undefined
                                ? $choice.data(metadata.text)
                                : (preserveHTML
                                    ? $choice.html() && $choice.html().trim()
                                    : $choice.text() && $choice.text().trim());
                        }
                    },
                    choiceValue: function ($choice, choiceText) {
                        choiceText = choiceText || module.get.choiceText($choice);
                        if (!$choice) {
                            return false;
                        }

                        return $choice.data(metadata.value) !== undefined
                            ? String($choice.data(metadata.value))
                            : (typeof choiceText === 'string'
                                ? String(
                                    settings.ignoreSearchCase
                                        ? choiceText.toLowerCase()
                                        : choiceText
                                ).trim()
                                : String(choiceText));
                    },
                    inputEvent: function () {
                        var
                            input = $search[0]
                        ;
                        if (input) {
                            return input.oninput !== undefined
                                ? 'input'
                                : (input.onpropertychange !== undefined
                                    ? 'propertychange'
                                    : 'keyup');
                        }

                        return false;
                    },
                    selectValues: function () {
                        var
                            select = {},
                            oldGroup = [],
                            values = []
                        ;
                        $module
                            .find('option')
                            .each(function () {
                                var
                                    $option  = $(this),
                                    name     = $option.html(),
                                    disabled = $option.attr('disabled'),
                                    value    = $option.attr('value') !== undefined
                                        ? $option.attr('value')
                                        : name,
                                    text     = $option.data(metadata.text) !== undefined
                                        ? $option.data(metadata.text)
                                        : name,
                                    group = $option.parent('optgroup')
                                ;
                                if (settings.placeholder === 'auto' && value === '') {
                                    select.placeholder = name;
                                } else {
                                    if (group.length !== oldGroup.length || group[0] !== oldGroup[0]) {
                                        values.push({
                                            type: 'header',
                                            divider: settings.headerDivider,
                                            name: group.attr('label') || '',
                                        });
                                        oldGroup = group;
                                    }
                                    values.push({
                                        name: name,
                                        value: value,
                                        text: module.escape.htmlEntities(text, true),
                                        disabled: disabled,
                                    });
                                }
                            })
                        ;
                        if (settings.placeholder && settings.placeholder !== 'auto') {
                            module.debug('Setting placeholder value to', settings.placeholder);
                            select.placeholder = settings.placeholder;
                        }
                        if (settings.sortSelect) {
                            if (settings.sortSelect === true) {
                                values.sort(function (a, b) {
                                    return a.name.localeCompare(b.name);
                                });
                            } else if (settings.sortSelect === 'natural') {
                                values.sort(function (a, b) {
                                    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
                                });
                            } else if (isFunction(settings.sortSelect)) {
                                values.sort(settings.sortSelect);
                            }
                            select[fields.values] = values;
                            module.debug('Retrieved and sorted values from select', select);
                        } else {
                            select[fields.values] = values;
                            module.debug('Retrieved values from select', select);
                        }

                        return select;
                    },
                    activeItem: function () {
                        return $item.filter('.' + className.active);
                    },
                    selectedItem: function () {
                        var
                            $selectedItem = $item.not(selector.unselectable).filter('.' + className.selected)
                        ;

                        return $selectedItem.length > 0
                            ? $selectedItem
                            : $item.eq(0);
                    },
                    itemWithAdditions: function (value) {
                        var
                            $items       = module.get.item(value),
                            $userItems   = module.create.userChoice(value),
                            hasUserItems = $userItems && $userItems.length > 0
                        ;
                        if (hasUserItems) {
                            $items = $items.length > 0
                                ? $items.add($userItems)
                                : $userItems;
                        }

                        return $items;
                    },
                    item: function (value, strict) {
                        var
                            $selectedItem = false,
                            shouldSearch,
                            isMultiple
                        ;
                        value = value !== undefined
                            ? value
                            : (module.get.values() !== undefined
                                ? module.get.values()
                                : module.get.text());
                        isMultiple = module.is.multiple() && Array.isArray(value);
                        shouldSearch = isMultiple
                            ? value.length > 0
                            : value !== undefined && value !== null;
                        strict = value === '' || value === false || value === true
                            ? true
                            : strict || false;
                        if (shouldSearch) {
                            $item
                                .each(function () {
                                    var
                                        $choice       = $(this),
                                        optionText    = module.get.choiceText($choice),
                                        optionValue   = module.get.choiceValue($choice, optionText)
                                    ;
                                    // safe early exit
                                    if (optionValue === null || optionValue === undefined) {
                                        return;
                                    }
                                    if (isMultiple) {
                                        if ($.inArray(module.escape.htmlEntities(String(optionValue)), value.map(String).map(module.escape.htmlEntities)) !== -1) {
                                            $selectedItem = $selectedItem
                                                ? $selectedItem.add($choice)
                                                : $choice;
                                        }
                                    } else if (strict) {
                                        module.verbose('Ambiguous dropdown value using strict type check', $choice, value);
                                        if (optionValue === value) {
                                            $selectedItem = $choice;

                                            return true;
                                        }
                                    } else {
                                        if (settings.ignoreCase) {
                                            optionValue = optionValue.toLowerCase();
                                            value = value.toLowerCase();
                                        }
                                        if (module.escape.htmlEntities(String(optionValue)) === module.escape.htmlEntities(String(value))) {
                                            module.verbose('Found select item by value', optionValue, value);
                                            $selectedItem = $choice;

                                            return true;
                                        }
                                    }
                                })
                            ;
                        }

                        return $selectedItem;
                    },
                    displayType: function () {
                        return $module.hasClass('column') ? 'flex' : settings.displayType;
                    },
                },

                check: {
                    maxSelections: function (selectionCount) {
                        if (settings.maxSelections) {
                            selectionCount = selectionCount !== undefined
                                ? selectionCount
                                : module.get.selectionCount();
                            if (selectionCount >= settings.maxSelections) {
                                module.debug('Maximum selection count reached');
                                if (settings.useLabels) {
                                    $item.addClass(className.filtered);
                                    module.add.message(message.maxSelections);
                                }

                                return true;
                            }

                            module.verbose('No longer at maximum selection count');
                            module.remove.message();
                            module.remove.filteredItem();
                            if (module.is.searchSelection()) {
                                module.filterItems();
                            }

                            return false;
                        }

                        return false;
                    },
                    disabled: function () {
                        $search.attr('tabindex', module.is.disabled() ? -1 : 0);
                    },
                },

                restore: {
                    defaults: function (preventChangeTrigger) {
                        module.clear(preventChangeTrigger);
                        module.restore.defaultText();
                        module.restore.defaultValue();
                    },
                    defaultText: function () {
                        var
                            defaultText     = module.get.defaultText(),
                            placeholderText = module.get.placeholderText
                        ;
                        if (defaultText === placeholderText) {
                            module.debug('Restoring default placeholder text', defaultText);
                            module.set.placeholderText(defaultText);
                        } else {
                            module.debug('Restoring default text', defaultText);
                            module.set.text(defaultText);
                        }
                    },
                    placeholderText: function () {
                        module.set.placeholderText();
                    },
                    defaultValue: function () {
                        var
                            defaultValue = module.get.defaultValue()
                        ;
                        if (defaultValue !== undefined) {
                            module.debug('Restoring default value', defaultValue);
                            if (defaultValue !== '') {
                                module.set.value(defaultValue);
                                module.set.selected();
                            } else {
                                module.remove.activeItem();
                                module.remove.selectedItem();
                            }
                        }
                    },
                    labels: function () {
                        if (settings.allowAdditions) {
                            if (!settings.useLabels) {
                                module.error(error.labels);
                                settings.useLabels = true;
                            }
                            module.debug('Restoring selected values');
                            module.create.userLabels();
                        }
                        module.check.maxSelections();
                    },
                    selected: function () {
                        module.restore.values();
                        if (module.is.multiple()) {
                            module.debug('Restoring previously selected values and labels');
                            module.restore.labels();
                        } else {
                            module.debug('Restoring previously selected values');
                        }
                    },
                    values: function () {
                        // prevents callbacks from occurring on initial load
                        module.set.initialLoad();
                        if (settings.apiSettings && settings.saveRemoteData && module.get.remoteValues()) {
                            module.restore.remoteValues();
                        } else {
                            module.set.selected();
                        }
                        var value = module.get.value();
                        if (value && value !== '' && !(Array.isArray(value) && value.length === 0)) {
                            $input.removeClass(className.noselection);
                        } else {
                            $input.addClass(className.noselection);
                        }
                        module.remove.initialLoad();
                    },
                    remoteValues: function () {
                        var
                            values = module.get.remoteValues()
                        ;
                        module.debug('Recreating selected from session data', values);
                        if (values) {
                            if (module.is.single()) {
                                $.each(values, function (value, name) {
                                    module.set.text(name);
                                });
                            } else if (settings.useLabels) {
                                $.each(values, function (value, name) {
                                    module.add.label(value, name);
                                });
                            }
                        }
                    },
                },

                read: {
                    remoteData: function (value) {
                        var
                            name
                        ;
                        if (window.Storage === undefined) {
                            module.error(error.noStorage);

                            return;
                        }
                        name = sessionStorage.getItem(value + elementNamespace);

                        return name !== undefined
                            ? name
                            : false;
                    },
                },

                save: {
                    defaults: function () {
                        module.save.defaultText();
                        module.save.placeholderText();
                        module.save.defaultValue();
                    },
                    defaultValue: function () {
                        var
                            value = module.get.value()
                        ;
                        module.verbose('Saving default value as', value);
                        $module.data(metadata.defaultValue, value);
                    },
                    defaultText: function () {
                        var
                            text = module.get.text()
                        ;
                        module.verbose('Saving default text as', text);
                        $module.data(metadata.defaultText, text);
                    },
                    placeholderText: function () {
                        var
                            text
                        ;
                        if (settings.placeholder !== false && $text.hasClass(className.placeholder)) {
                            text = module.get.text();
                            module.verbose('Saving placeholder text as', text);
                            $module.data(metadata.placeholderText, text);
                        }
                    },
                    remoteData: function (name, value) {
                        if (window.Storage === undefined) {
                            module.error(error.noStorage);

                            return;
                        }
                        module.verbose('Saving remote data to session storage', value, name);
                        sessionStorage.setItem(value + elementNamespace, name);
                    },
                },

                clear: function (preventChangeTrigger) {
                    if (module.is.multiple() && settings.useLabels) {
                        module.remove.labels($module.find(selector.label), preventChangeTrigger);
                    } else {
                        module.remove.activeItem();
                        module.remove.selectedItem();
                        module.remove.filteredItem();
                    }
                    module.set.placeholderText();
                    module.clearValue(preventChangeTrigger);
                },

                clearValue: function (preventChangeTrigger) {
                    module.set.value('', null, null, preventChangeTrigger);
                },

                clearCache: function () {
                    module.debug('Clearing API cache once');
                    tempDisableApiCache = true;
                },

                scrollPage: function (direction, $selectedItem) {
                    var
                        $currentItem  = $selectedItem || module.get.selectedItem(),
                        $menu         = $currentItem.closest(selector.menu),
                        menuHeight    = $menu.outerHeight(),
                        currentScroll = $menu.scrollTop(),
                        itemHeight    = $item.eq(0).outerHeight(),
                        itemsPerPage  = Math.floor(menuHeight / itemHeight),
                        newScroll     = direction === 'up'
                            ? currentScroll - (itemHeight * itemsPerPage)
                            : currentScroll + (itemHeight * itemsPerPage),
                        $selectableItem = $item.not(selector.unselectable),
                        isWithinRange,
                        $nextSelectedItem,
                        elementIndex
                    ;
                    elementIndex = direction === 'up'
                        ? $selectableItem.index($currentItem) - itemsPerPage
                        : $selectableItem.index($currentItem) + itemsPerPage;
                    isWithinRange = direction === 'up'
                        ? elementIndex >= 0
                        : elementIndex < $selectableItem.length;
                    $nextSelectedItem = isWithinRange
                        ? $selectableItem.eq(elementIndex)
                        : (direction === 'up'
                            ? $selectableItem.first()
                            : $selectableItem.last());
                    if ($nextSelectedItem.length > 0) {
                        module.debug('Scrolling page', direction, $nextSelectedItem);
                        $currentItem
                            .removeClass(className.selected)
                        ;
                        $nextSelectedItem
                            .addClass(className.selected)
                        ;
                        if (settings.selectOnKeydown && module.is.single() && !$nextSelectedItem.hasClass(className.actionable)) {
                            module.set.selectedItem($nextSelectedItem);
                        }
                        $menu
                            .scrollTop(newScroll)
                        ;
                    }
                },

                set: {
                    filtered: function () {
                        var
                            isMultiple       = module.is.multiple(),
                            isSearch         = module.is.searchSelection(),
                            isSearchMultiple = isMultiple && isSearch,
                            searchValue      = isSearch
                                ? module.get.query()
                                : '',
                            hasSearchValue   = typeof searchValue === 'string' && searchValue.length > 0,
                            searchWidth      = module.get.searchWidth(),
                            valueIsSet       = searchValue !== ''
                        ;
                        if (isMultiple && hasSearchValue) {
                            module.verbose('Adjusting input width', searchWidth);
                            $search.css('width', searchWidth + 'px');
                        }
                        if (hasSearchValue || (isSearchMultiple && valueIsSet)) {
                            module.verbose('Hiding placeholder text');
                            $text.addClass(className.filtered);
                        } else if (!isMultiple || (isSearchMultiple && !valueIsSet)) {
                            module.verbose('Showing placeholder text');
                            $text.removeClass(className.filtered);
                        }
                    },
                    empty: function () {
                        $module.addClass(className.empty);
                    },
                    loading: function () {
                        $module.addClass(className.loading);
                    },
                    placeholderText: function (text) {
                        text = text || module.get.placeholderText();
                        module.debug('Setting placeholder text', text);
                        module.set.text(text);
                        $text.addClass(className.placeholder);
                    },
                    tabbable: function () {
                        if (module.is.searchSelection()) {
                            module.debug('Added tabindex to searchable dropdown');
                            $search
                                .val('')
                            ;
                            module.check.disabled();
                            $menu
                                .attr('tabindex', -1)
                            ;
                        } else {
                            module.debug('Added tabindex to dropdown');
                            if ($module.attr('tabindex') === undefined) {
                                $module
                                    .attr('tabindex', $input.attr('tabindex') || 0)
                                ;
                                $menu
                                    .attr('tabindex', -1)
                                ;
                            }
                        }
                        $input.removeAttr('tabindex');
                    },
                    initialLoad: function () {
                        module.verbose('Setting initial load');
                        initialLoad = true;
                    },
                    activeItem: function ($item) {
                        if (settings.allowAdditions && $item.filter(selector.addition).length > 0) {
                            $item.addClass(className.filtered);
                        } else {
                            $item.addClass(className.active);
                        }
                    },
                    partialSearch: function (text) {
                        var
                            length = module.get.query().length
                        ;
                        $search.val(text.slice(0, length));
                    },
                    scrollPosition: function ($item, forceScroll) {
                        var
                            edgeTolerance = 5,
                            $menu,
                            hasActive,
                            offset,
                            itemOffset,
                            menuOffset,
                            menuScroll,
                            menuHeight,
                            abovePage,
                            belowPage
                        ;

                        $item = $item || module.get.selectedItem();
                        $menu = $item.closest(selector.menu);
                        hasActive = $item && $item.length > 0;
                        forceScroll = forceScroll !== undefined
                            ? forceScroll
                            : false;
                        if (module.get.activeItem().length === 0) {
                            forceScroll = false;
                        }
                        if ($item && $menu.length > 0 && hasActive) {
                            itemOffset = $item.position().top;

                            $menu.addClass(className.loading);
                            menuScroll = $menu.scrollTop();
                            menuOffset = $menu.offset().top;
                            itemOffset = $item.offset().top;
                            offset = menuScroll - menuOffset + itemOffset;
                            if (!forceScroll) {
                                menuHeight = $menu.height();
                                belowPage = menuScroll + menuHeight < (offset + edgeTolerance);
                                abovePage = (offset - edgeTolerance) < menuScroll;
                            }
                            module.debug('Scrolling to active item', offset);
                            if (forceScroll || abovePage || belowPage) {
                                $menu.scrollTop(offset);
                            }
                            $menu.removeClass(className.loading);
                        }
                    },
                    text: function (text, isNotPlaceholder) {
                        if (settings.action === 'combo') {
                            module.debug('Changing combo button text', text, $combo);
                            if (settings.preserveHTML) {
                                $combo.html(text);
                            } else {
                                $combo.text(text);
                            }
                        } else if (settings.action === 'activate' || isFunction(settings.action)) {
                            if (text !== module.get.placeholderText() || isNotPlaceholder) {
                                $text.removeClass(className.placeholder);
                            }
                            module.debug('Changing text', text, $text);
                            $text
                                .removeClass(className.filtered)
                            ;
                            if (settings.preserveHTML) {
                                $text.html(text);
                            } else {
                                $text.text(text);
                            }
                        }
                    },
                    selectedItem: function ($item) {
                        var
                            value      = module.get.choiceValue($item),
                            searchText = module.get.choiceText($item, false),
                            text       = module.get.choiceText($item)
                        ;
                        module.debug('Setting user selection to item', $item);
                        module.remove.activeItem();
                        module.set.partialSearch(searchText);
                        module.set.activeItem($item);
                        module.set.selected(value, $item);
                        module.set.text(text);
                    },
                    selectedLetter: function (letter) {
                        var
                            $selectedItem         = $item.filter('.' + className.selected),
                            alreadySelectedLetter = $selectedItem.length > 0 && module.has.firstLetter($selectedItem, letter),
                            $nextValue            = false,
                            $nextItem
                        ;
                        // check next of same letter
                        if (alreadySelectedLetter) {
                            $nextItem = $selectedItem.nextAll($item).eq(0);
                            if (module.has.firstLetter($nextItem, letter)) {
                                $nextValue = $nextItem;
                            }
                        }
                        // check all values
                        if (!$nextValue) {
                            $item
                                .each(function () {
                                    if (module.has.firstLetter($(this), letter)) {
                                        $nextValue = $(this);

                                        return false;
                                    }
                                })
                            ;
                        }
                        // set next value
                        if ($nextValue) {
                            module.verbose('Scrolling to next value with letter', letter);
                            module.set.scrollPosition($nextValue);
                            $selectedItem.removeClass(className.selected);
                            $nextValue.addClass(className.selected);
                            if (settings.selectOnKeydown && module.is.single() && (!$nextItem || !$nextItem.hasClass(className.actionable))) {
                                module.set.selectedItem($nextValue);
                            }
                        }
                    },
                    direction: function ($menu) {
                        if (settings.direction === 'auto') {
                            // reset position, remove upward if it's base menu
                            if (!$menu) {
                                module.remove.upward();
                            } else if (module.is.upward($menu)) {
                                // we need make sure when make assertion openDownward for $menu, $menu does not have upward class
                                module.remove.upward($menu);
                            }

                            if (module.can.openDownward($menu)) {
                                module.remove.upward($menu);
                            } else {
                                module.set.upward($menu);
                            }
                            if (!module.is.leftward($menu) && !module.can.openRightward($menu)) {
                                module.set.leftward($menu);
                            }
                        } else if (settings.direction === 'upward') {
                            module.set.upward($menu);
                        }
                    },
                    upward: function ($currentMenu) {
                        var $element = $currentMenu || $module;
                        $element.addClass(className.upward);
                    },
                    leftward: function ($currentMenu) {
                        var $element = $currentMenu || $menu;
                        $element.addClass(className.leftward);
                    },
                    value: function (value, text, $selected, preventChangeTrigger) {
                        if (typeof text === 'boolean') {
                            preventChangeTrigger = text;
                            $selected = undefined;
                            text = undefined;
                        }
                        if (value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)) {
                            $input.removeClass(className.noselection);
                        } else {
                            $input.addClass(className.noselection);
                        }
                        var
                            escapedValue = module.escape.value(value),
                            hasInput     = $input.length > 0,
                            currentValue = module.get.values(),
                            stringValue  = value !== undefined
                                ? String(value)
                                : value
                        ;
                        if (hasInput) {
                            if (!settings.allowReselection && stringValue == currentValue) {
                                module.verbose('Skipping value update already same value', value, currentValue);
                                if (!module.is.initialLoad()) {
                                    return;
                                }
                            }

                            if (module.is.single() && module.has.selectInput() && module.can.extendSelect()) {
                                module.debug('Adding user option', value);
                                module.add.optionValue(value);
                            }
                            module.debug('Updating input value', escapedValue, currentValue);
                            internalChange = true;
                            $input
                                .val(escapedValue)
                            ;
                            if (settings.fireOnInit === false && module.is.initialLoad()) {
                                module.debug('Input native change event ignored on initial load');
                            } else if (preventChangeTrigger !== true) {
                                module.trigger.change();
                            }
                            internalChange = false;
                        } else {
                            module.verbose('Storing value in metadata', escapedValue, $input);
                            if (escapedValue !== currentValue) {
                                $module.data(metadata.value, stringValue);
                            }
                        }
                        if (settings.fireOnInit === false && module.is.initialLoad()) {
                            module.verbose('No callback on initial load', settings.onChange);
                        } else if (preventChangeTrigger !== true) {
                            settings.onChange.call(element, value, text, $selected);
                        }
                    },
                    active: function () {
                        $module
                            .addClass(className.active)
                        ;
                    },
                    multiple: function () {
                        $module.addClass(className.multiple);
                    },
                    visible: function () {
                        $module.addClass(className.visible);
                    },
                    exactly: function (value, $selectedItem, preventChangeTrigger) {
                        if (typeof $selectedItem === 'boolean') {
                            preventChangeTrigger = $selectedItem;
                            $selectedItem = undefined;
                        }
                        module.debug('Setting selected to exact values');
                        module.clear();
                        module.set.selected(value, $selectedItem, preventChangeTrigger);
                    },
                    selected: function (value, $selectedItem, preventChangeTrigger, keepSearchTerm) {
                        if (typeof $selectedItem === 'boolean') {
                            keepSearchTerm = preventChangeTrigger;
                            preventChangeTrigger = $selectedItem;
                            $selectedItem = undefined;
                        }
                        var
                            isMultiple = module.is.multiple()
                        ;
                        $selectedItem = settings.allowAdditions
                            ? $selectedItem || module.get.itemWithAdditions(value)
                            : $selectedItem || module.get.item(value);
                        if (!$selectedItem && value !== undefined) {
                            return false;
                        }
                        if (isMultiple) {
                            if (!keepSearchTerm) {
                                module.remove.searchWidth();
                            }
                            if (settings.useLabels) {
                                module.remove.selectedItem();
                                if (value === undefined) {
                                    module.remove.labels($module.find(selector.label), true);
                                }
                            }
                        } else {
                            module.remove.activeItem();
                            module.remove.selectedItem();
                        }
                        if (!$selectedItem) {
                            return false;
                        }
                        module.debug('Setting selected menu item to', $selectedItem);
                        // select each item
                        $selectedItem
                            .each(function () {
                                var
                                    $selected      = $(this),
                                    selectedText   = module.get.choiceText($selected),
                                    selectedValue  = module.get.choiceValue($selected, selectedText),

                                    isFiltered     = $selected.hasClass(className.filtered),
                                    isActive       = $selected.hasClass(className.active),
                                    isActionable   = $selected.hasClass(className.actionable),
                                    isUserValue    = $selected.hasClass(className.addition),
                                    shouldAnimate  = isMultiple && $selectedItem && $selectedItem.length === 1
                                ;
                                if (isActionable) {
                                    if ((!isMultiple || (!isActive || isUserValue)) && settings.apiSettings && settings.saveRemoteData) {
                                        module.save.remoteData(selectedText, selectedValue);
                                    }
                                    settings.onActionable.call(element, selectedValue, selectedText, $selected);
                                } else if (isMultiple) {
                                    if (!isActive || isUserValue) {
                                        if (settings.apiSettings && settings.saveRemoteData) {
                                            module.save.remoteData(selectedText, selectedValue);
                                        }
                                        if (settings.useLabels) {
                                            module.add.label(selectedValue, selectedText, shouldAnimate);
                                            module.add.value(selectedValue, selectedText, $selected, preventChangeTrigger);
                                            module.set.activeItem($selected);
                                            module.filterActive();
                                            module.select.nextAvailable($selectedItem);
                                        } else {
                                            module.add.value(selectedValue, selectedText, $selected, preventChangeTrigger);
                                            module.set.text(module.add.variables(message.count));
                                            module.set.activeItem($selected);
                                        }
                                    } else if (!isFiltered && (settings.useLabels || selectActionActive)) {
                                        module.debug('Selected active value, removing label');
                                        module.remove.selected(selectedValue);
                                    }
                                } else {
                                    if (settings.apiSettings && settings.saveRemoteData) {
                                        module.save.remoteData(selectedText, selectedValue);
                                    }
                                    if (!keepSearchTerm && !$selected.hasClass(className.actionable)) {
                                        module.set.text(selectedText, true);
                                    }
                                    module.set.value(selectedValue, selectedText, $selected, preventChangeTrigger);
                                    $selected
                                        .addClass(className.active)
                                        .addClass(className.selected)
                                    ;
                                }
                            })
                        ;
                        if (!keepSearchTerm) {
                            module.remove.searchTerm();
                        }
                        if (module.is.allFiltered()) {
                            module.set.empty();
                            module.hideMenu();
                        }
                    },
                },

                add: {
                    label: function (value, text, shouldAnimate) {
                        var
                            $next  = module.is.searchSelection()
                                ? $search
                                : $text,
                            escapedValue = module.escape.value(value),
                            $label
                        ;
                        if (settings.ignoreCase) {
                            escapedValue = escapedValue.toLowerCase();
                        }
                        $label = $('<a />')
                            .addClass(className.label)
                            .attr('data-' + metadata.value, escapedValue)
                            .html(templates.label(escapedValue, text, settings.preserveHTML, settings.className))
                        ;
                        $label = settings.onLabelCreate.call($label, escapedValue, text);

                        if (module.has.label(value)) {
                            module.debug('User selection already exists, skipping', escapedValue);

                            return;
                        }
                        if (settings.label.variation) {
                            $label.addClass(settings.label.variation);
                        }
                        if (shouldAnimate === true && settings.label.transition) {
                            module.debug('Animating in label', $label);
                            $label
                                .addClass(className.hidden)
                                .insertBefore($next)
                                .transition({
                                    animation: settings.label.transition,
                                    debug: settings.debug,
                                    verbose: settings.verbose,
                                    silent: settings.silent,
                                    duration: settings.label.duration,
                                })
                            ;
                        } else {
                            module.debug('Adding selection label', $label);
                            $label
                                .insertBefore($next)
                            ;
                        }
                    },
                    message: function (message) {
                        var
                            $message = $menu.children(selector.message),
                            html     = settings.templates.message(module.add.variables(message))
                        ;
                        if ($message.length > 0) {
                            $message
                                .html(html)
                            ;
                        } else {
                            $('<div/>')
                                .html(html)
                                .addClass(className.message)
                                .appendTo($menu)
                            ;
                        }
                    },
                    optionValue: function (value) {
                        var
                            escapedValue = module.escape.value(value),
                            $option      = $input.find('option[value="' + module.escape.string(escapedValue) + '"]'),
                            hasOption    = $option.length > 0
                        ;
                        if (hasOption) {
                            return;
                        }
                        // temporarily disconnect observer
                        module.disconnect.selectObserver();
                        if (module.is.single()) {
                            module.verbose('Removing previous user addition');
                            $input.find('option.' + className.addition).remove();
                        }
                        $('<option/>')
                            .prop('value', escapedValue)
                            .addClass(className.addition)
                            .text(value)
                            .appendTo($input)
                        ;
                        module.verbose('Adding user addition as an <option>', value);
                        module.observe.select();
                    },
                    userSuggestion: function (value) {
                        var
                            $addition         = $menu.children(selector.addition),
                            $existingItem     = module.get.item(value),
                            alreadyHasValue   = $existingItem && $existingItem.not(selector.addition).length > 0,
                            hasUserSuggestion = $addition.length > 0,
                            html
                        ;
                        if (settings.useLabels && module.has.maxSelections()) {
                            return;
                        }
                        if (value === '' || alreadyHasValue) {
                            $addition.remove();

                            return;
                        }
                        if (hasUserSuggestion) {
                            $addition
                                .data(metadata.value, value)
                                .data(metadata.text, value)
                                .attr('data-' + metadata.value, value)
                                .attr('data-' + metadata.text, value)
                                .removeClass(className.filtered)
                            ;
                            if (!settings.hideAdditions) {
                                html = settings.templates.addition(module.add.variables(message.addResult, value));
                                $addition
                                    .html(html)
                                ;
                            }
                            module.verbose('Replacing user suggestion with new value', $addition);
                        } else {
                            $addition = module.create.userChoice(value);
                            $addition
                                .prependTo($menu)
                            ;
                            module.verbose('Adding item choice to menu corresponding with user choice addition', $addition);
                        }
                        if (!settings.hideAdditions || module.is.allFiltered()) {
                            $addition
                                .addClass(className.selected)
                                .siblings()
                                .removeClass(className.selected)
                            ;
                        }
                        module.refreshItems();
                    },
                    variables: function (message, term) {
                        var
                            hasCount    = message.search('{count}') !== -1,
                            hasMaxCount = message.search('{maxCount}') !== -1,
                            hasTerm     = message.search('{term}') !== -1,
                            query
                        ;
                        module.verbose('Adding templated variables to message', message);
                        if (hasCount) {
                            message = message.replace('{count}', module.get.selectionCount());
                        }
                        if (hasMaxCount) {
                            message = message.replace('{maxCount}', settings.maxSelections);
                        }
                        if (hasTerm) {
                            query = term || module.get.query();
                            message = message.replace('{term}', query);
                        }

                        return message;
                    },
                    value: function (addedValue, addedText, $selectedItem, preventChangeTrigger) {
                        if (typeof addedText === 'boolean') {
                            preventChangeTrigger = addedText;
                            $selectedItem = undefined;
                            addedText = undefined;
                        }
                        var
                            currentValue = module.get.values(true),
                            newValue
                        ;
                        if (module.has.value(addedValue)) {
                            module.debug('Value already selected');

                            return;
                        }
                        if (addedValue === '') {
                            module.debug('Cannot select blank values from multiselect');

                            return;
                        }
                        // extend current array
                        if (Array.isArray(currentValue)) {
                            newValue = $selectedItem && $selectedItem.hasClass(className.actionable) ? currentValue : currentValue.concat([addedValue]);
                            newValue = module.get.uniqueArray(newValue);
                        } else {
                            newValue = [addedValue];
                        }
                        // add values
                        if (module.has.selectInput()) {
                            if (module.can.extendSelect()) {
                                module.debug('Adding value to select', addedValue, newValue, $input);
                                module.add.optionValue(addedValue);
                            }
                        } else {
                            newValue = newValue.join(settings.delimiter);
                            module.debug('Setting hidden input to delimited value', newValue, $input);
                        }

                        if (settings.fireOnInit === false && module.is.initialLoad()) {
                            module.verbose('Skipping onadd callback on initial load', settings.onAdd);
                        } else {
                            settings.onAdd.call(element, addedValue, addedText, $selectedItem);
                        }
                        module.set.value(newValue, addedText, $selectedItem, preventChangeTrigger);
                        module.check.maxSelections();
                    },
                },

                remove: {
                    active: function () {
                        $module.removeClass(className.active);
                    },
                    activeLabel: function () {
                        $module.find(selector.label).removeClass(className.active);
                    },
                    empty: function () {
                        $module.removeClass(className.empty);
                    },
                    loading: function () {
                        $module.removeClass(className.loading);
                    },
                    initialLoad: function () {
                        initialLoad = false;
                    },
                    upward: function ($currentMenu) {
                        var $element = $currentMenu || $module;
                        $element.removeClass(className.upward);
                    },
                    leftward: function ($currentMenu) {
                        var $element = $currentMenu || $menu;
                        $element.removeClass(className.leftward);
                    },
                    visible: function () {
                        $module.removeClass(className.visible);
                    },
                    activeItem: function () {
                        $item.removeClass(className.active);
                    },
                    filteredItem: function () {
                        if (settings.highlightMatches) {
                            $.each($item, function (index, item) {
                                var $markItem = $(item);
                                $markItem.html($markItem.html().replace(/<\/?mark>/g, ''));
                            });
                        }
                        if (settings.useLabels && module.has.maxSelections()) {
                            return;
                        }
                        if (settings.useLabels && module.is.multiple()) {
                            $item.not('.' + className.active).removeClass(className.filtered);
                        } else {
                            $item.removeClass(className.filtered);
                        }
                        if (settings.hideDividers) {
                            $divider.removeClass(className.hidden);
                        }
                        module.remove.empty();
                    },
                    optionValue: function (value) {
                        var
                            escapedValue = module.escape.value(value),
                            $option      = $input.find('option[value="' + module.escape.string(escapedValue) + '"]'),
                            hasOption    = $option.length > 0
                        ;
                        if (!hasOption || !$option.hasClass(className.addition)) {
                            return;
                        }
                        // temporarily disconnect observer
                        module.disconnect.selectObserver();
                        $option.remove();
                        module.verbose('Removing user addition as an <option>', escapedValue);
                        module.observe.select();
                    },
                    message: function () {
                        $menu.children(selector.message).remove();
                    },
                    searchWidth: function () {
                        $search.css('width', '');
                    },
                    searchTerm: function () {
                        module.verbose('Cleared search term');
                        $search.val('');
                        module.set.filtered();
                    },
                    userAddition: function () {
                        $item.filter(selector.addition).remove();
                    },
                    selected: function (value, $selectedItem, preventChangeTrigger) {
                        $selectedItem = settings.allowAdditions
                            ? $selectedItem || module.get.itemWithAdditions(value)
                            : $selectedItem || module.get.item(value);

                        if (!$selectedItem) {
                            return false;
                        }

                        $selectedItem
                            .each(function () {
                                var
                                    $selected     = $(this),
                                    selectedText  = module.get.choiceText($selected),
                                    selectedValue = module.get.choiceValue($selected, selectedText)
                                ;
                                if (module.is.multiple()) {
                                    if (settings.useLabels) {
                                        module.remove.value(selectedValue, selectedText, $selected, preventChangeTrigger);
                                        module.remove.label(selectedValue);
                                    } else {
                                        module.remove.value(selectedValue, selectedText, $selected, preventChangeTrigger);
                                        if (module.get.selectionCount() === 0) {
                                            module.set.placeholderText();
                                        } else {
                                            module.set.text(module.add.variables(message.count));
                                        }
                                    }
                                } else {
                                    module.remove.value(selectedValue, selectedText, $selected, preventChangeTrigger);
                                }
                                $selected
                                    .removeClass(className.filtered)
                                    .removeClass(className.active)
                                ;
                                if (settings.useLabels) {
                                    $selected.removeClass(className.selected);
                                }
                            })
                        ;
                    },
                    selectedItem: function () {
                        $item.removeClass(className.selected);
                    },
                    value: function (removedValue, removedText, $removedItem, preventChangeTrigger) {
                        var
                            values = module.get.values(true),
                            newValue
                        ;
                        if (module.has.selectInput()) {
                            module.verbose('Input is <select> removing selected option', removedValue);
                            newValue = module.remove.arrayValue(removedValue, values);
                            module.remove.optionValue(removedValue);
                        } else {
                            module.verbose('Removing from delimited values', removedValue);
                            newValue = module.remove.arrayValue(removedValue, values);
                            newValue = newValue.join(settings.delimiter);
                        }
                        if (settings.fireOnInit === false && module.is.initialLoad()) {
                            module.verbose('No callback on initial load', settings.onRemove);
                        } else {
                            settings.onRemove.call(element, removedValue, removedText, $removedItem);
                        }
                        module.set.value(newValue, removedText, $removedItem, preventChangeTrigger);
                        module.check.maxSelections();
                    },
                    arrayValue: function (removedValue, values) {
                        if (!Array.isArray(values)) {
                            values = [values];
                        }
                        values = $.grep(values, function (value) {
                            return removedValue != value;
                        });
                        module.verbose('Removed value from delimited string', removedValue, values);

                        return values;
                    },
                    label: function (value, shouldAnimate) {
                        var
                            escapedValue  = module.escape.value(value),
                            $labels       = $module.find(selector.label),
                            $removedLabel = $labels.filter('[data-' + metadata.value + '="' + module.escape.string(settings.ignoreCase ? escapedValue.toLowerCase() : escapedValue) + '"]')
                        ;
                        module.verbose('Removing label', $removedLabel);
                        $removedLabel.remove();
                    },
                    activeLabels: function ($activeLabels) {
                        $activeLabels = $activeLabels || $module.find(selector.label).filter('.' + className.active);
                        module.verbose('Removing active label selections', $activeLabels);
                        module.remove.labels($activeLabels);
                    },
                    labels: function ($labels, preventChangeTrigger) {
                        $labels = $labels || $module.find(selector.label);
                        module.verbose('Removing labels', $labels);
                        $labels
                            .each(function () {
                                var
                                    $label      = $(this),
                                    value       = $label.data(metadata.value),
                                    stringValue = value !== undefined
                                        ? String(value)
                                        : value,
                                    isUserValue = module.is.userValue(stringValue)
                                ;
                                if (settings.onLabelRemove.call($label, value) === false) {
                                    module.debug('Label remove callback cancelled removal');

                                    return;
                                }
                                module.remove.message();
                                if (isUserValue) {
                                    module.remove.value(stringValue, stringValue, module.get.item(stringValue), preventChangeTrigger);
                                    module.remove.label(stringValue);
                                } else {
                                    // selected will also remove label
                                    module.remove.selected(stringValue, false, preventChangeTrigger);
                                }
                            })
                        ;
                    },
                    tabbable: function () {
                        if (module.is.searchSelection()) {
                            module.debug('Searchable dropdown initialized');
                            $search
                                .removeAttr('tabindex')
                            ;
                            $menu
                                .removeAttr('tabindex')
                            ;
                        } else {
                            module.debug('Simple selection dropdown initialized');
                            $module
                                .removeAttr('tabindex')
                            ;
                            $menu
                                .removeAttr('tabindex')
                            ;
                        }
                    },
                    diacritics: function (text) {
                        return settings.ignoreDiacritics ? text.normalize('NFD').replace(/[\u0300-\u036F]/g, '') : text;
                    },
                },

                has: {
                    menuSearch: function () {
                        return module.has.search() && $search.closest($menu).length > 0;
                    },
                    clearItem: function () {
                        return $clear.length > 0;
                    },
                    search: function () {
                        return $search.length > 0;
                    },
                    sizer: function () {
                        return $sizer.length > 0;
                    },
                    selectInput: function () {
                        return $input.is('select');
                    },
                    minCharacters: function (searchTerm) {
                        if (settings.minCharacters && !iconClicked) {
                            searchTerm = searchTerm !== undefined
                                ? String(searchTerm)
                                : String(module.get.query());

                            return searchTerm.length >= settings.minCharacters;
                        }
                        iconClicked = false;

                        return true;
                    },
                    firstLetter: function ($item, letter) {
                        var
                            text,
                            firstLetter
                        ;
                        if (!$item || $item.length === 0 || typeof letter !== 'string') {
                            return false;
                        }
                        text = module.get.choiceText($item, false);
                        letter = letter.toLowerCase();
                        firstLetter = String(text).charAt(0).toLowerCase();

                        return letter == firstLetter;
                    },
                    input: function () {
                        return $input.length > 0;
                    },
                    items: function () {
                        return $item.length > 0;
                    },
                    menu: function () {
                        return $menu.length > 0;
                    },
                    subMenu: function ($currentMenu) {
                        return ($currentMenu || $menu).find(selector.menu).length > 0;
                    },
                    message: function () {
                        return $menu.children(selector.message).length > 0;
                    },
                    label: function (value) {
                        var
                            escapedValue = module.escape.value(value),
                            $labels      = $module.find(selector.label)
                        ;
                        if (settings.ignoreCase) {
                            escapedValue = escapedValue.toLowerCase();
                        }

                        return $labels.filter('[data-' + metadata.value + '="' + module.escape.string(escapedValue) + '"]').length > 0;
                    },
                    maxSelections: function () {
                        return settings.maxSelections && module.get.selectionCount() >= settings.maxSelections;
                    },
                    allResultsFiltered: function () {
                        var
                            $normalResults = $item.not(selector.addition)
                        ;

                        return $normalResults.filter(selector.unselectable).length === $normalResults.length;
                    },
                    userSuggestion: function () {
                        return $menu.children(selector.addition).length > 0;
                    },
                    query: function () {
                        return module.get.query() !== '';
                    },
                    value: function (value) {
                        return settings.ignoreCase
                            ? module.has.valueIgnoringCase(value)
                            : module.has.valueMatchingCase(value);
                    },
                    valueMatchingCase: function (value) {
                        var
                            values   = module.get.values(true),
                            hasValue = Array.isArray(values)
                                ? values && ($.inArray(value, values) !== -1)
                                : values == value
                        ;

                        return !!hasValue;
                    },
                    valueIgnoringCase: function (value) {
                        var
                            values   = module.get.values(true),
                            hasValue = false
                        ;
                        if (!Array.isArray(values)) {
                            values = [values];
                        }
                        $.each(values, function (index, existingValue) {
                            if (String(value).toLowerCase() === String(existingValue).toLowerCase()) {
                                hasValue = true;

                                return false;
                            }
                        });

                        return hasValue;
                    },
                },

                is: {
                    active: function () {
                        return $module.hasClass(className.active);
                    },
                    animatingInward: function () {
                        return $menu.transition('is inward');
                    },
                    animatingOutward: function () {
                        return $menu.transition('is outward');
                    },
                    bubbledLabelClick: function (event) {
                        return $(event.target).is('select, input') && $module.closest('label').length > 0;
                    },
                    bubbledIconClick: function (event) {
                        return $(event.target).closest($icon).length > 0;
                    },
                    edge: function () {
                        return !!window.chrome && !!window.StyleMedia;
                    },
                    empty: function () {
                        return $module.hasClass(className.empty);
                    },
                    chrome: function () {
                        return !!window.chrome && !window.StyleMedia;
                    },
                    alreadySetup: function () {
                        return $module.is('select') && $module.parent(selector.dropdown).data(moduleNamespace) !== undefined && $module.prev().length === 0;
                    },
                    animating: function ($subMenu) {
                        return $subMenu
                            ? $subMenu.transition && $subMenu.transition('is animating')
                            : $menu.transition && $menu.transition('is animating');
                    },
                    leftward: function ($subMenu) {
                        var $selectedMenu = $subMenu || $menu;

                        return $selectedMenu.hasClass(className.leftward);
                    },
                    clearable: function () {
                        var hasClearableClass = $module.hasClass(className.clearable);
                        if (!hasClearableClass && settings.clearable) {
                            $module.addClass(className.clearable);
                        }

                        return hasClearableClass || settings.clearable;
                    },
                    disabled: function () {
                        return $module.hasClass(className.disabled);
                    },
                    focused: function () {
                        return document.activeElement === $module[0];
                    },
                    focusedOnSearch: function () {
                        return document.activeElement === $search[0];
                    },
                    allFiltered: function () {
                        return (module.is.multiple() || module.has.search()) && !(!settings.hideAdditions && module.has.userSuggestion()) && !module.has.message() && module.has.allResultsFiltered();
                    },
                    hidden: function ($subMenu) {
                        return !module.is.visible($subMenu);
                    },
                    initialLoad: function () {
                        return initialLoad;
                    },
                    inObject: function (needle, object) {
                        var
                            found = false
                        ;
                        $.each(object, function (index, property) {
                            if (property == needle) {
                                found = true;

                                return true;
                            }
                        });

                        return found;
                    },
                    multiple: function () {
                        return $module.hasClass(className.multiple);
                    },
                    remote: function () {
                        return settings.apiSettings && module.can.useAPI();
                    },
                    noApiCache: function () {
                        return tempDisableApiCache || (settings.apiSettings && !settings.apiSettings.cache);
                    },
                    single: function () {
                        return !module.is.multiple();
                    },
                    selectMutation: function (mutations) {
                        var
                            selectChanged = false
                        ;
                        $.each(mutations, function (index, mutation) {
                            if ($(mutation.target).is('option, optgroup') || $(mutation.addedNodes).is('select') || ($(mutation.target).is('select') && mutation.type !== 'attributes')) {
                                selectChanged = true;

                                return false;
                            }
                        });

                        return selectChanged;
                    },
                    search: function () {
                        return $module.hasClass(className.search);
                    },
                    searchSelection: function (deep) {
                        return module.has.search() && (deep ? $search.parents(selector.dropdown) : $search.parent(selector.dropdown)).length === 1;
                    },
                    selection: function () {
                        return $module.hasClass(className.selection);
                    },
                    userValue: function (value) {
                        return $.inArray(value, module.get.userValues()) !== -1;
                    },
                    upward: function ($menu) {
                        var $element = $menu || $module;

                        return $element.hasClass(className.upward);
                    },
                    visible: function ($subMenu) {
                        return $subMenu
                            ? $subMenu.hasClass(className.visible)
                            : $menu.hasClass(className.visible);
                    },
                    verticallyScrollableContext: function () {
                        var
                            overflowY = $context[0] !== window
                                ? $context.css('overflow-y')
                                : false
                        ;

                        return overflowY === 'auto' || overflowY === 'scroll';
                    },
                    horizontallyScrollableContext: function () {
                        var
                            overflowX = $context[0] !== window
                                ? $context.css('overflow-X')
                                : false
                        ;

                        return overflowX === 'auto' || overflowX === 'scroll';
                    },
                },

                can: {
                    activate: function ($item) {
                        return (
                            settings.useLabels
                                || !module.has.maxSelections()
                                || (module.has.maxSelections() && $item.hasClass(className.active))
                        );
                    },
                    openDownward: function ($subMenu) {
                        var
                            $currentMenu    = $subMenu || $menu,
                            canOpenDownward,
                            onScreen,
                            calculations
                        ;
                        $currentMenu
                            .addClass(className.loading)
                        ;
                        calculations = {
                            context: {
                                offset: $context[0] === window
                                    ? { top: 0, left: 0 }
                                    : $context.offset(),
                                scrollTop: $context.scrollTop(),
                                height: $context.outerHeight(),
                            },
                            menu: {
                                offset: $currentMenu.offset(),
                                height: $currentMenu.outerHeight(),
                            },
                        };
                        if (module.is.verticallyScrollableContext()) {
                            calculations.menu.offset.top += calculations.context.scrollTop;
                        }
                        if (module.has.subMenu($currentMenu)) {
                            calculations.menu.height += $currentMenu.find(selector.menu).first().outerHeight();
                        }
                        onScreen = {
                            above: calculations.context.scrollTop <= calculations.menu.offset.top - calculations.context.offset.top - calculations.menu.height,
                            below: (calculations.context.scrollTop + calculations.context.height) >= calculations.menu.offset.top - calculations.context.offset.top + calculations.menu.height,
                        };
                        if (onScreen.below) {
                            module.verbose('Dropdown can fit in context downward', onScreen);
                            canOpenDownward = true;
                        } else if (!onScreen.below && !onScreen.above) {
                            module.verbose('Dropdown cannot fit in either direction, favoring downward', onScreen);
                            canOpenDownward = true;
                        } else {
                            module.verbose('Dropdown cannot fit below, opening upward', onScreen);
                            canOpenDownward = false;
                        }
                        $currentMenu.removeClass(className.loading);

                        return canOpenDownward;
                    },
                    openRightward: function ($subMenu) {
                        var
                            $currentMenu     = $subMenu || $menu,
                            canOpenRightward = true,
                            isOffscreenRight = false,
                            calculations
                        ;
                        $currentMenu
                            .addClass(className.loading)
                        ;
                        calculations = {
                            context: {
                                offset: $context[0] === window
                                    ? { top: 0, left: 0 }
                                    : $context.offset(),
                                scrollLeft: $context.scrollLeft(),
                                width: $context.outerWidth(),
                            },
                            menu: {
                                offset: $currentMenu.offset(),
                                width: $currentMenu.outerWidth(),
                            },
                        };
                        if (module.is.horizontallyScrollableContext()) {
                            calculations.menu.offset.left += calculations.context.scrollLeft;
                        }
                        isOffscreenRight = calculations.menu.offset.left - calculations.context.offset.left + calculations.menu.width >= calculations.context.scrollLeft + calculations.context.width;
                        if (isOffscreenRight) {
                            module.verbose('Dropdown cannot fit in context rightward', isOffscreenRight);
                            canOpenRightward = false;
                        }
                        $currentMenu.removeClass(className.loading);

                        return canOpenRightward;
                    },
                    extendSelect: function () {
                        return settings.allowAdditions || settings.apiSettings;
                    },
                    show: function () {
                        return !module.is.disabled() && (module.has.items() || module.has.message());
                    },
                    useAPI: function () {
                        return $.fn.api !== undefined;
                    },
                    useElement: function (element) {
                        if ($.fn[element] !== undefined) {
                            return true;
                        }
                        module.error(error.noElement.replace('{element}', element));

                        return false;
                    },
                },

                animate: {
                    show: function (callback, $subMenu) {
                        var
                            $currentMenu = $subMenu || $menu,
                            start = $subMenu
                                ? function () {}
                                : function () {
                                    module.hideSubMenus();
                                    module.hideOthers();
                                    module.set.active();
                                },
                            transition
                        ;
                        callback = isFunction(callback)
                            ? callback
                            : function () {};
                        module.verbose('Doing menu show animation', $currentMenu);
                        module.set.direction($subMenu);
                        transition = settings.transition.showMethod || module.get.transition($subMenu);
                        if (module.is.selection()) {
                            module.set.scrollPosition(module.get.selectedItem(), true);
                        }
                        if (module.is.hidden($currentMenu) || module.is.animating($currentMenu)) {
                            if (transition === 'none') {
                                start();
                                $currentMenu.transition({
                                    displayType: module.get.displayType(),
                                }).transition('show');
                                callback.call(element);
                            } else if (module.can.useElement('transition')) {
                                $currentMenu
                                    .transition({
                                        animation: transition + ' in',
                                        debug: settings.debug,
                                        verbose: settings.verbose,
                                        silent: settings.silent,
                                        duration: settings.transition.showDuration || settings.duration,
                                        queue: true,
                                        onStart: start,
                                        displayType: module.get.displayType(),
                                        onComplete: function () {
                                            callback.call(element);
                                        },
                                    })
                                ;
                            }
                        }
                    },
                    hide: function (callback, $subMenu) {
                        var
                            $currentMenu = $subMenu || $menu,
                            start = $subMenu
                                ? function () {}
                                : function () {
                                    module.unbind.intent();
                                    module.remove.active();
                                },
                            transition = settings.transition.hideMethod || module.get.transition($subMenu)
                        ;
                        callback = isFunction(callback)
                            ? callback
                            : function () {};
                        if (module.is.visible($currentMenu) || module.is.animating($currentMenu)) {
                            module.verbose('Doing menu hide animation', $currentMenu);

                            if (transition === 'none') {
                                start();
                                $currentMenu.transition({
                                    displayType: module.get.displayType(),
                                }).transition('hide');
                                callback.call(element);
                            } else if ($.fn.transition !== undefined) {
                                $currentMenu
                                    .transition({
                                        animation: transition + ' out',
                                        duration: settings.transition.hideDuration || settings.duration,
                                        debug: settings.debug,
                                        verbose: settings.verbose,
                                        silent: settings.silent,
                                        queue: false,
                                        onStart: start,
                                        displayType: module.get.displayType(),
                                        onComplete: function () {
                                            callback.call(element);
                                        },
                                    })
                                ;
                            } else {
                                module.error(error.transition);
                            }
                        }
                    },
                },

                hideAndClear: function () {
                    module.remove.searchTerm();
                    if (module.has.maxSelections()) {
                        return;
                    }
                    if (module.has.search()) {
                        module.hide(function () {
                            module.remove.filteredItem();
                        });
                    } else {
                        module.hide();
                    }
                },

                delay: {
                    show: function () {
                        module.verbose('Delaying show event to ensure user intent');
                        clearTimeout(module.timer);
                        module.timer = setTimeout(function () {
                            module.show();
                        }, settings.delay.show);
                    },
                    hide: function () {
                        module.verbose('Delaying hide event to ensure user intent');
                        clearTimeout(module.timer);
                        module.timer = setTimeout(function () {
                            module.hide();
                        }, settings.delay.hide);
                    },
                },

                escape: {
                    value: function (value) {
                        var
                            multipleValues = Array.isArray(value),
                            stringValue    = typeof value === 'string',
                            isUnparsable   = !stringValue && !multipleValues,
                            hasQuotes      = stringValue && value.search(regExp.quote) !== -1,
                            values         = []
                        ;
                        if (isUnparsable || !hasQuotes) {
                            return value;
                        }
                        module.debug('Encoding quote values for use in select', value);
                        if (multipleValues) {
                            $.each(value, function (index, value) {
                                values.push(value.replace(regExp.quote, '&quot;'));
                            });

                            return values;
                        }

                        return value.replace(regExp.quote, '&quot;');
                    },
                    string: function (text) {
                        text = String(text);

                        return text.replace(regExp.escape, '\\$&');
                    },
                    htmlEntities: function (string, forceAmpersand) {
                        forceAmpersand = typeof forceAmpersand === 'number' ? false : forceAmpersand;
                        var
                            badChars     = /["'<>`]/g,
                            shouldEscape = /["&'<>`]/,
                            escape       = {
                                '<': '&lt;',
                                '>': '&gt;',
                                '"': '&quot;',
                                "'": '&#x27;',
                                '`': '&#x60;',
                            },
                            escapedChar  = function (chr) {
                                return escape[chr];
                            }
                        ;
                        if (shouldEscape.test(string)) {
                            string = string.replace(forceAmpersand ? /&/g : /&(?![\d#a-z]{1,12};)/gi, '&amp;');
                            string = string.replace(badChars, escapedChar);
                        }

                        return string;
                    },
                },

                setting: function (name, value) {
                    module.debug('Changing setting', name, value);
                    if ($.isPlainObject(name)) {
                        $.extend(true, settings, name);
                    } else if (value !== undefined) {
                        if ($.isPlainObject(settings[name])) {
                            $.extend(true, settings[name], value);
                        } else {
                            settings[name] = value;
                        }
                    } else {
                        return settings[name];
                    }
                },
                internal: function (name, value) {
                    if ($.isPlainObject(name)) {
                        $.extend(true, module, name);
                    } else if (value !== undefined) {
                        module[name] = value;
                    } else {
                        return module[name];
                    }
                },
                debug: function () {
                    if (!settings.silent && settings.debug) {
                        if (settings.performance) {
                            module.performance.log(arguments);
                        } else {
                            module.debug = Function.prototype.bind.call(console.info, console, settings.name + ':');
                            module.debug.apply(console, arguments);
                        }
                    }
                },
                verbose: function () {
                    if (!settings.silent && settings.verbose && settings.debug) {
                        if (settings.performance) {
                            module.performance.log(arguments);
                        } else {
                            module.verbose = Function.prototype.bind.call(console.info, console, settings.name + ':');
                            module.verbose.apply(console, arguments);
                        }
                    }
                },
                error: function () {
                    if (!settings.silent) {
                        module.error = Function.prototype.bind.call(console.error, console, settings.name + ':');
                        module.error.apply(console, arguments);
                    }
                },
                performance: {
                    log: function (message) {
                        var
                            currentTime,
                            executionTime,
                            previousTime
                        ;
                        if (settings.performance) {
                            currentTime = Date.now();
                            previousTime = time || currentTime;
                            executionTime = currentTime - previousTime;
                            time = currentTime;
                            performance.push({
                                Name: message[0],
                                Arguments: [].slice.call(message, 1) || '',
                                Element: element,
                                'Execution Time': executionTime,
                            });
                        }
                        clearTimeout(module.performance.timer);
                        module.performance.timer = setTimeout(function () {
                            module.performance.display();
                        }, 500);
                    },
                    display: function () {
                        var
                            title = settings.name + ':',
                            totalTime = 0
                        ;
                        time = false;
                        clearTimeout(module.performance.timer);
                        $.each(performance, function (index, data) {
                            totalTime += data['Execution Time'];
                        });
                        title += ' ' + totalTime + 'ms';
                        if (performance.length > 0) {
                            console.groupCollapsed(title);
                            if (console.table) {
                                console.table(performance);
                            } else {
                                $.each(performance, function (index, data) {
                                    console.log(data.Name + ': ' + data['Execution Time'] + 'ms');
                                });
                            }
                            console.groupEnd();
                        }
                        performance = [];
                    },
                },
                invoke: function (query, passedArguments, context) {
                    var
                        object = instance,
                        maxDepth,
                        found,
                        response
                    ;
                    passedArguments = passedArguments || queryArguments;
                    context = context || element;
                    if (typeof query === 'string' && object !== undefined) {
                        query = query.split(/[ .]/);
                        maxDepth = query.length - 1;
                        $.each(query, function (depth, value) {
                            var camelCaseValue = depth !== maxDepth
                                ? value + query[depth + 1].charAt(0).toUpperCase() + query[depth + 1].slice(1)
                                : query
                            ;
                            if ($.isPlainObject(object[camelCaseValue]) && (depth !== maxDepth)) {
                                object = object[camelCaseValue];
                            } else if (object[camelCaseValue] !== undefined) {
                                found = object[camelCaseValue];

                                return false;
                            } else if ($.isPlainObject(object[value]) && (depth !== maxDepth)) {
                                object = object[value];
                            } else if (object[value] !== undefined) {
                                found = object[value];

                                return false;
                            } else {
                                module.error(error.method, query);

                                return false;
                            }
                        });
                    }
                    if (isFunction(found)) {
                        response = found.apply(context, passedArguments);
                    } else if (found !== undefined) {
                        response = found;
                    }
                    if (Array.isArray(returnedValue)) {
                        returnedValue.push(response);
                    } else if (returnedValue !== undefined) {
                        returnedValue = [returnedValue, response];
                    } else if (response !== undefined) {
                        returnedValue = response;
                    }

                    return found;
                },
            };

            if (methodInvoked) {
                if (instance === undefined) {
                    module.initialize();
                }
                module.invoke(query);
            } else {
                if (instance !== undefined) {
                    instance.invoke('destroy');
                }
                module.initialize();
            }
        });

        return returnedValue !== undefined
            ? returnedValue
            : $allModules;
    };

    $.fn.dropdown.settings = {

        silent: false,
        debug: false,
        verbose: false,
        performance: true,

        on: 'click', // what event should show menu action on item selection
        action: 'activate', // action on item selection (nothing, activate, select, combo, hide, function(){})

        values: false, // specify values to use for dropdown

        clearable: false, // whether the value of the dropdown can be cleared

        apiSettings: false,
        selectOnKeydown: true, // Whether selection should occur automatically when keyboard shortcuts used
        minCharacters: 0, // Minimum characters required to trigger API call

        filterRemoteData: false, // Whether API results should be filtered after being returned for query term
        saveRemoteData: true, // Whether remote name/value pairs should be stored in sessionStorage to allow remote data to be restored on page refresh

        throttle: 200, // How long to wait after last user input to search remotely

        context: window, // Context to use when determining if on screen
        direction: 'auto', // Whether dropdown should always open in one direction
        keepOnScreen: true, // Whether dropdown should check whether it is on screen before showing

        match: 'both', // what to match against with search selection (both, text, or label)
        fullTextSearch: 'exact', // search anywhere in value (set to 'exact' to require exact matches)
        highlightMatches: false, // Whether search result should highlight matching strings
        ignoreDiacritics: false, // match results also if they contain diacritics of the same base character (for example searching for "a" will also match "á" or "â" or "à", etc...)
        hideDividers: false, // Whether to hide any divider elements (specified in selector.divider) that are sibling to any items when searched (set to true will hide all dividers, set to 'empty' will hide them when they are not followed by a visible item)

        placeholder: 'auto', // whether to convert blank <select> values to placeholder text
        preserveHTML: true, // preserve html when selecting value
        sortSelect: false, // sort selection on init

        forceSelection: false, // force a choice on blur with search selection

        allowAdditions: false, // whether multiple select should allow user added values
        keepSearchTerm: false, // whether the search value should be kept and menu stays filtered on item selection
        ignoreCase: false, // whether to consider case sensitivity when creating labels
        ignoreSearchCase: true, // whether to consider case sensitivity when filtering items
        hideAdditions: true, // whether or not to hide special message prompting a user they can enter a value

        maxSelections: false, // When set to a number limits the number of selections to this count
        useLabels: true, // whether multiple select should filter currently active selections from choices
        delimiter: ',', // when multiselect uses normal <input> the values will be delimited with this character

        showOnFocus: false, // show menu on focus
        allowReselection: false, // whether current value should trigger callbacks when reselected
        allowTab: true, // add tabindex to element
        allowCategorySelection: false, // allow elements with sub-menus to be selected

        fireOnInit: false, // Whether callbacks should fire when initializing dropdown values

        transition: 'auto', // auto transition will slide down or up based on direction
        duration: 200, // duration of transition
        displayType: false, // displayType of transition

        headerDivider: true, // whether option headers should have an additional divider line underneath when converted from <select> <optgroup>

        collapseOnActionable: true, // whether the dropdown should collapse upon selection of an actionable item
        collapseOnClearable: false, // whether the dropdown should collapse upon clicking the clearable icon

        // label settings on multi-select
        label: {
            transition: 'scale',
            duration: 200,
            variation: false,
        },

        // delay before event
        delay: {
            hide: 300,
            show: 200,
            search: 20,
        },

        /* Callbacks */
        onChange: function (value, text, $selected) {},
        onAdd: function (value, text, $selected) {},
        onRemove: function (value, text, $selected) {},
        onActionable: function (value, text, $selected) {},
        onSearch: function (searchTerm) {},

        onLabelSelect: function ($selectedLabels) {},
        onLabelCreate: function (value, text) {
            return $(this);
        },
        onLabelRemove: function (value) {
            return true;
        },
        onNoResults: function (searchTerm) {
            return true;
        },
        onShow: function () {},
        onHide: function () {},

        /* Component */
        name: 'Dropdown',
        namespace: 'dropdown',

        message: {
            addResult: 'Add <b>{term}</b>',
            count: '{count} selected',
            maxSelections: 'Max {maxCount} selections',
            noResults: 'No results found.',
            serverError: 'There was an error contacting the server',
        },

        error: {
            action: 'You called a dropdown action that was not defined',
            alreadySetup: 'Once a select has been initialized behaviors must be called on the created ui dropdown',
            labels: 'Allowing user additions currently requires the use of labels.',
            missingMultiple: '<select> requires multiple property to be set to correctly preserve multiple values',
            method: 'The method you called is not defined.',
            noAPI: 'The API module is required to load resources remotely',
            noStorage: 'Saving remote data requires session storage',
            noElement: 'This module requires ui {element}',
            noNormalize: '"ignoreDiacritics" setting will be ignored. Browser does not support String().normalize(). You may consider including <https://cdn.jsdelivr.net/npm/unorm@1.4.1/lib/unorm.min.js> as a polyfill.',
        },

        regExp: {
            escape: /[\s#$()*+,.:=?@[\\\]^{|}-]/g,
            quote: /"/g,
        },

        metadata: {
            defaultText: 'defaultText',
            defaultValue: 'defaultValue',
            placeholderText: 'placeholder',
            text: 'text',
            value: 'value',
        },

        // property names for remote query
        fields: {
            remoteValues: 'results', // grouping for api results
            values: 'values', // grouping for all dropdown values
            disabled: 'disabled', // whether value should be disabled
            name: 'name', // displayed dropdown text
            description: 'description', // displayed dropdown description
            descriptionVertical: 'descriptionVertical', // whether description should be vertical
            value: 'value', // actual dropdown value
            text: 'text', // displayed text when selected
            data: 'data', // custom data attributes
            type: 'type', // type of dropdown element
            image: 'image', // optional image path
            imageClass: 'imageClass', // optional individual class for image
            alt: 'alt', // optional alt text for image
            icon: 'icon', // optional icon name
            iconClass: 'iconClass', // optional individual class for icon (for example to use flag instead)
            class: 'class', // optional individual class for item/header
            divider: 'divider', // optional divider append for group headers
            actionable: 'actionable', // optional actionable item
        },

        keys: {
            backspace: 8,
            deleteKey: 46,
            enter: 13,
            escape: 27,
            pageUp: 33,
            pageDown: 34,
            leftArrow: 37,
            upArrow: 38,
            rightArrow: 39,
            downArrow: 40,
        },

        selector: {
            addition: '.addition',
            divider: '.divider, .header',
            dropdown: '.ui.dropdown',
            hidden: '.hidden',
            icon: '> .dropdown.icon',
            input: '> input[type="hidden"], > select',
            item: '.item',
            label: '> .label',
            remove: '> .label > .delete.icon',
            siblingLabel: '.label',
            menu: '.menu',
            message: '.message',
            menuIcon: '.dropdown.icon',
            search: 'input.search, .menu > .search > input, .menu input.search',
            sizer: '> span.sizer',
            text: '> .text:not(.icon)',
            unselectable: '.disabled, .filtered',
            clearIcon: '> .remove.icon',
        },

        className: {
            active: 'active',
            addition: 'addition',
            animating: 'animating',
            description: 'description',
            descriptionVertical: 'vertical',
            disabled: 'disabled',
            empty: 'empty',
            dropdown: 'ui dropdown',
            filtered: 'filtered',
            hidden: 'hidden transition',
            icon: 'icon',
            image: 'image',
            item: 'item',
            label: 'ui label',
            loading: 'loading',
            menu: 'menu',
            message: 'message',
            multiple: 'multiple',
            placeholder: 'default',
            sizer: 'sizer',
            search: 'search',
            selected: 'selected',
            selection: 'selection',
            text: 'text',
            upward: 'upward',
            leftward: 'left',
            visible: 'visible',
            clearable: 'clearable',
            noselection: 'noselection',
            delete: 'delete',
            header: 'header',
            divider: 'divider',
            groupIcon: '',
            unfilterable: 'unfilterable',
            actionable: 'actionable',
        },

    };

    /* Templates */
    $.fn.dropdown.settings.templates = {
        deQuote: function (string, encode) {
            return String(string).replace(/"/g, encode ? '&quot;' : '');
        },
        escape: function (string, preserveHTML) {
            if (preserveHTML) {
                return string;
            }
            var
                badChars     = /["'<>`]/g,
                shouldEscape = /["&'<>`]/,
                escape       = {
                    '<': '&lt;',
                    '>': '&gt;',
                    '"': '&quot;',
                    "'": '&#x27;',
                    '`': '&#x60;',
                },
                escapedChar  = function (chr) {
                    return escape[chr];
                }
            ;
            if (shouldEscape.test(string)) {
                string = string.replace(/&(?![\d#a-z]{1,12};)/gi, '&amp;');
                string = string.replace(badChars, escapedChar);
            }

            return string;
        },
        // generates dropdown from select values
        dropdown: function (select, fields, preserveHTML, className) {
            var
                placeholder = select.placeholder || false,
                html        = '',
                escape = $.fn.dropdown.settings.templates.escape,
                deQuote = $.fn.dropdown.settings.templates.deQuote
            ;
            html += '<i class="dropdown icon"></i>';
            html += placeholder
                ? '<div class="default text">' + escape(placeholder, preserveHTML) + '</div>'
                : '<div class="text"></div>';
            html += '<div class="' + deQuote(className.menu) + '">';
            html += $.fn.dropdown.settings.templates.menu(select, fields, preserveHTML, className);
            html += '</div>';

            return html;
        },

        // generates just menu from select
        menu: function (response, fields, preserveHTML, className) {
            var
                values = response[fields.values] || [],
                html   = '',
                escape = $.fn.dropdown.settings.templates.escape,
                deQuote = $.fn.dropdown.settings.templates.deQuote
            ;
            $.each(values, function (index, option) {
                var
                    itemType = option[fields.type] || 'item',
                    isMenu = itemType.indexOf('menu') !== -1,
                    maybeData = '',
                    dataObject = option[fields.data]
                ;
                if (dataObject) {
                    var dataKey,
                        dataKeyEscaped
                    ;
                    for (dataKey in dataObject) {
                        dataKeyEscaped = String(dataKey).replace(/\W/g, '');
                        if (Object.prototype.hasOwnProperty.call(dataObject, dataKey) && ['text', 'value'].indexOf(dataKeyEscaped.toLowerCase()) === -1) {
                            maybeData += ' data-' + dataKeyEscaped + '="' + deQuote(String(dataObject[dataKey])) + '"';
                        }
                    }
                }
                if (itemType === 'item' || isMenu) {
                    var
                        maybeText = option[fields.text]
                            ? ' data-text="' + deQuote(option[fields.text], true) + '"'
                            : '',
                        maybeActionable = option[fields.actionable]
                            ? className.actionable + ' '
                            : '',
                        maybeDisabled = option[fields.disabled]
                            ? className.disabled + ' '
                            : '',
                        maybeDescriptionVertical = option[fields.descriptionVertical]
                            ? className.descriptionVertical + ' '
                            : '',
                        hasDescription = escape(option[fields.description] || '', preserveHTML) !== ''
                    ;
                    html += '<div class="' + deQuote(maybeActionable + maybeDisabled + maybeDescriptionVertical + (option[fields.class] || className.item)) + '" data-value="' + deQuote(option[fields.value], true) + '"' + maybeText + maybeData + '>';
                    if (isMenu) {
                        html += '<i class="' + (itemType.indexOf('left') !== -1 ? 'left' : '') + ' dropdown icon"></i>';
                    }
                    if (option[fields.image]) {
                        html += '<img class="' + deQuote(option[fields.imageClass] || className.image) + '" src="' + deQuote(option[fields.image]) + (option[fields.alt] ? '" alt="' + deQuote(option[fields.alt]) : '') + '">';
                    }
                    if (option[fields.icon]) {
                        html += '<i class="' + deQuote(option[fields.icon] + ' ' + (option[fields.iconClass] || className.icon)) + '"></i>';
                    }
                    if (hasDescription) {
                        html += '<span class="' + deQuote(className.description) + '">' + escape(option[fields.description] || '', preserveHTML) + '</span>';
                        html += !isMenu ? '<span class="' + deQuote(className.text) + '">' : '';
                    }
                    if (isMenu) {
                        html += '<span class="' + deQuote(className.text) + '">';
                    }
                    html += escape(option[fields.name] || '', preserveHTML);
                    if (isMenu) {
                        html += '</span>';
                        html += '<div class="' + deQuote(itemType) + '">';
                        html += $.fn.dropdown.settings.templates.menu(option, fields, preserveHTML, className);
                        html += '</div>';
                    } else if (hasDescription) {
                        html += '</span>';
                    }
                    html += '</div>';
                } else if (itemType === 'header') {
                    var
                        groupName = escape(option[fields.name] || '', preserveHTML),
                        groupIcon = deQuote(option[fields.icon] || className.groupIcon)
                    ;
                    if (groupName !== '' || groupIcon !== '') {
                        html += '<div class="' + deQuote(option[fields.class] || className.header) + '">';
                        if (groupIcon !== '') {
                            html += '<i class="' + deQuote(groupIcon + ' ' + (option[fields.iconClass] || className.icon)) + '"></i>';
                        }
                        html += groupName;
                        html += '</div>';
                    }
                    if (option[fields.divider]) {
                        html += '<div class="' + deQuote(className.divider) + '"></div>';
                    }
                }
            });

            return html;
        },

        // generates label for multiselect
        label: function (value, text, preserveHTML, className) {
            var
                escape = $.fn.dropdown.settings.templates.escape,
                deQuote = $.fn.dropdown.settings.templates.deQuote
            ;

            return escape(text, preserveHTML) + '<i class="' + deQuote(className.delete) + ' icon"></i>';
        },

        // generates messages like "No results"
        message: function (message) {
            return message;
        },

        // generates user addition to selection menu
        addition: function (choice) {
            return choice;
        },

    };
})(jQuery, window, document);

/*!
 * # Fomantic-UI 2.9.4 - Form Validation
 * https://github.com/fomantic/Fomantic-UI/
 *
 *
 * Released under the MIT license
 * https://opensource.org/licenses/MIT
 *
 */

(function ($, window, document) {
    'use strict';

    function isFunction(obj) {
        return typeof obj === 'function' && typeof obj.nodeType !== 'number';
    }

    window = window !== undefined && window.Math === Math
        ? window
        : globalThis;

    $.fn.form = function (parameters) {
        var
            $allModules      = $(this),
            $window        = $(window),

            time             = Date.now(),
            performance      = [],

            query            = arguments[0],
            methodInvoked    = typeof query === 'string',
            queryArguments   = [].slice.call(arguments, 1),
            returnedValue
        ;
        $allModules.each(function () {
            var
                $module     = $(this),
                element     = this,

                formErrors  = [],
                formErrorsTracker = {},
                keyHeldDown = false,

                // set at run-time
                $field,
                $group,
                $message,
                $prompt,
                $submit,
                $clear,
                $reset,

                settings,
                validation,

                metadata,
                selector,
                className,
                regExp,
                error,

                namespace,
                moduleNamespace,
                eventNamespace,
                attachEventsSelector,
                attachEventsAction,

                submitting = false,
                dirty = false,
                history = ['clean', 'clean'],

                instance,
                module
            ;

            module = {

                initialize: function () {
                    // settings grabbed at run time
                    module.get.settings();
                    $module.addClass(className.initial);
                    if (methodInvoked) {
                        if (instance === undefined) {
                            module.instantiate();
                        }
                        module.invoke(query);
                    } else {
                        if (instance !== undefined) {
                            instance.invoke('destroy');
                            module.refresh();
                        }
                        module.verbose('Initializing form validation', $module, settings);
                        module.bindEvents();
                        module.set.defaults();
                        if (settings.autoCheckRequired) {
                            module.set.autoCheck();
                        }
                        module.instantiate();
                    }
                },

                instantiate: function () {
                    module.verbose('Storing instance of module', module);
                    instance = module;
                    $module
                        .data(moduleNamespace, module)
                    ;
                },

                destroy: function () {
                    module.verbose('Destroying previous module', instance);
                    module.removeEvents();
                    $module
                        .removeData(moduleNamespace)
                    ;
                },

                refresh: function () {
                    module.verbose('Refreshing selector cache');
                    $field = $module.find(selector.field);
                    $group = $module.find(selector.group);
                    $message = $module.find(selector.message);
                    $prompt = $module.find(selector.prompt);

                    $submit = $module.find(selector.submit);
                    $clear = $module.find(selector.clear);
                    $reset = $module.find(selector.reset);
                },

                refreshEvents: function () {
                    module.removeEvents();
                    module.bindEvents();
                },

                submit: function (event) {
                    module.verbose('Submitting form', $module);
                    submitting = true;
                    $module.trigger('submit');
                    if (event) {
                        event.preventDefault();
                    }
                },

                attachEvents: function (selector, action) {
                    if (!action) {
                        action = 'submit';
                    }

                    $(selector).on('click' + eventNamespace, function (event) {
                        module[action]();
                        event.preventDefault();
                    });

                    attachEventsSelector = selector;
                    attachEventsAction = action;
                },

                bindEvents: function () {
                    module.verbose('Attaching form events');
                    $module
                        .on('submit' + eventNamespace, module.validate.form)
                        .on('blur' + eventNamespace, selector.field, module.event.field.blur)
                        .on('click' + eventNamespace, selector.submit, module.submit)
                        .on('click' + eventNamespace, selector.reset, module.reset)
                        .on('click' + eventNamespace, selector.clear, module.clear)
                    ;
                    $field.on('invalid' + eventNamespace, module.event.field.invalid);
                    if (settings.keyboardShortcuts) {
                        $module.on('keydown' + eventNamespace, selector.field, module.event.field.keydown);
                    }
                    $field.each(function (index, el) {
                        var
                            $input     = $(el),
                            type       = $input.prop('type'),
                            inputEvent = module.get.changeEvent(type, $input)
                        ;
                        $input.on(inputEvent + eventNamespace, module.event.field.change);
                    });

                    // Dirty events
                    if (settings.preventLeaving) {
                        $window.on('beforeunload' + eventNamespace, module.event.beforeUnload);
                    }

                    $field.on('change' + eventNamespace
                        + ' click' + eventNamespace
                        + ' keyup' + eventNamespace
                        + ' keydown' + eventNamespace
                        + ' blur' + eventNamespace, function (e) {
                        module.determine.isDirty();
                    });

                    $module.on('dirty' + eventNamespace, function (e) {
                        settings.onDirty.call();
                    });

                    $module.on('clean' + eventNamespace, function (e) {
                        settings.onClean.call();
                    });
                    if (attachEventsSelector) {
                        module.attachEvents(attachEventsSelector, attachEventsAction);
                    }
                },

                clear: function () {
                    $field.each(function (index, el) {
                        var
                            $field       = $(el),
                            $element     = $field.parent(),
                            $fieldGroup  = $field.closest($group),
                            $prompt      = $fieldGroup.find(selector.prompt),
                            $calendar    = $field.closest(selector.uiCalendar),
                            defaultValue = $field.data(metadata.defaultValue) || '',
                            isCheckbox   = $field.is(selector.checkbox),
                            isDropdown   = $element.is(selector.uiDropdown) && module.can.useElement('dropdown'),
                            isCalendar   = $calendar.length > 0 && module.can.useElement('calendar'),
                            isErrored    = $fieldGroup.hasClass(className.error)
                        ;
                        if (isErrored) {
                            module.verbose('Resetting error on field', $fieldGroup);
                            $fieldGroup.removeClass(className.error);
                            $prompt.remove();
                        }
                        if (isDropdown) {
                            module.verbose('Resetting dropdown value', $element, defaultValue);
                            $element.dropdown('clear', true);
                        } else if (isCheckbox) {
                            $field.prop('checked', false);
                        } else if (isCalendar) {
                            $calendar.calendar('clear');
                        } else {
                            module.verbose('Resetting field value', $field, defaultValue);
                            $field.val('');
                        }
                    });
                    module.remove.states();
                },

                reset: function () {
                    $field.each(function (index, el) {
                        var
                            $field       = $(el),
                            $element     = $field.parent(),
                            $fieldGroup  = $field.closest($group),
                            $calendar    = $field.closest(selector.uiCalendar),
                            $prompt      = $fieldGroup.find(selector.prompt),
                            defaultValue = $field.data(metadata.defaultValue),
                            isCheckbox   = $field.is(selector.checkbox),
                            isDropdown   = $element.is(selector.uiDropdown) && module.can.useElement('dropdown'),
                            isCalendar   = $calendar.length > 0 && module.can.useElement('calendar'),
                            isFile       = $field.is(selector.file),
                            isErrored    = $fieldGroup.hasClass(className.error)
                        ;
                        if (defaultValue === undefined) {
                            return;
                        }
                        if (isErrored) {
                            module.verbose('Resetting error on field', $fieldGroup);
                            $fieldGroup.removeClass(className.error);
                            $prompt.remove();
                        }
                        if (isDropdown) {
                            module.verbose('Resetting dropdown value', $element, defaultValue);
                            $element.dropdown('restore defaults', true);
                        } else if (isCheckbox) {
                            module.verbose('Resetting checkbox value', $field, defaultValue);
                            $field.prop('checked', defaultValue);
                        } else if (isCalendar) {
                            $calendar.calendar('set date', defaultValue);
                        } else {
                            module.verbose('Resetting field value', $field, defaultValue);
                            $field.val(isFile ? '' : defaultValue);
                        }
                    });
                    module.remove.states();
                },

                determine: {
                    isValid: function () {
                        var
                            allValid = true
                        ;
                        $field.each(function (index, el) {
                            var $el = $(el),
                                validation = module.get.validation($el) || {},
                                identifier = module.get.identifier(validation, $el)
                            ;
                            if (!module.validate.field(validation, identifier, true)) {
                                allValid = false;
                            }
                        });

                        return allValid;
                    },
                    isDirty: function (e) {
                        var formIsDirty = false;

                        $field.each(function (index, el) {
                            var
                                $el = $(el),
                                isCheckbox = $el.filter(selector.checkbox).length > 0,
                                isDirty
                            ;

                            isDirty = isCheckbox
                                ? module.is.checkboxDirty($el)
                                : module.is.fieldDirty($el);

                            $el.data(settings.metadata.isDirty, isDirty);

                            formIsDirty = formIsDirty || isDirty;
                        });

                        if (formIsDirty) {
                            module.set.dirty();
                        } else {
                            module.set.clean();
                        }
                    },
                },

                is: {
                    bracketedRule: function (rule) {
                        return rule.type && rule.type.match(settings.regExp.bracket);
                    },
                    // duck type rule test
                    shorthandRules: function (rules) {
                        return typeof rules === 'string' || Array.isArray(rules);
                    },
                    empty: function ($field) {
                        if (!$field || $field.length === 0) {
                            return true;
                        }
                        if ($field.is(selector.checkbox)) {
                            return !$field.is(':checked');
                        }

                        return module.is.blank($field);
                    },
                    blank: function ($field) {
                        return String($field.val()).trim() === '';
                    },
                    valid: function (field, showErrors) {
                        var
                            allValid = true
                        ;
                        if (field) {
                            module.verbose('Checking if field is valid', field);

                            return module.validate.field(validation[field], field, !!showErrors);
                        }

                        module.verbose('Checking if form is valid');
                        $.each(validation, function (fieldName, field) {
                            if (!module.is.valid(fieldName, showErrors)) {
                                allValid = false;
                            }
                        });

                        return allValid;
                    },
                    dirty: function () {
                        return dirty;
                    },
                    clean: function () {
                        return !dirty;
                    },
                    fieldDirty: function ($el) {
                        var initialValue = $el.data(metadata.defaultValue);
                        // Explicitly check for undefined/null here as value may be `false`, so ($el.data(dataInitialValue) || '') would not work
                        if (initialValue === undefined || initialValue === null) {
                            initialValue = '';
                        } else if (Array.isArray(initialValue)) {
                            initialValue = initialValue.toString();
                        }
                        var currentValue = $el.val();
                        if (currentValue === undefined || currentValue === null) {
                            currentValue = '';
                        } else if (Array.isArray(currentValue)) {
                            // multiple select values are returned as arrays which are never equal, so do string conversion first
                            currentValue = currentValue.toString();
                        }
                        // Boolean values can be encoded as "true/false" or "True/False" depending on underlying frameworks so we need a case insensitive comparison
                        var boolRegex = /^(true|false)$/i;
                        var isBoolValue = boolRegex.test(initialValue) && boolRegex.test(currentValue);
                        if (isBoolValue) {
                            var regex = new RegExp('^' + initialValue + '$', 'i');

                            return !regex.test(currentValue);
                        }

                        return currentValue !== initialValue;
                    },
                    checkboxDirty: function ($el) {
                        var initialValue = $el.data(metadata.defaultValue);
                        var currentValue = $el.is(':checked');

                        return initialValue !== currentValue;
                    },
                    justDirty: function () {
                        return history[0] === 'dirty';
                    },
                    justClean: function () {
                        return history[0] === 'clean';
                    },
                },

                removeEvents: function () {
                    $module.off(eventNamespace);
                    $field.off(eventNamespace);
                    $submit.off(eventNamespace);
                    if (settings.preventLeaving) {
                        $window.off(eventNamespace);
                    }
                    if (attachEventsSelector) {
                        $(attachEventsSelector).off(eventNamespace);
                        attachEventsSelector = undefined;
                    }
                },

                event: {
                    field: {
                        keydown: function (event) {
                            var
                                $field       = $(this),
                                key          = event.which,
                                isInput      = $field.is(selector.input),
                                isCheckbox   = $field.is(selector.checkbox),
                                isInDropdown = $field.closest(selector.uiDropdown).length > 0,
                                keyCode      = {
                                    enter: 13,
                                    escape: 27,
                                }
                            ;
                            if (key === keyCode.escape) {
                                module.verbose('Escape key pressed blurring field');
                                $field[0]
                                    .blur()
                                ;
                            }
                            if (!event.ctrlKey && key === keyCode.enter && isInput && !isInDropdown && !isCheckbox) {
                                if (!keyHeldDown) {
                                    $field.one('keyup' + eventNamespace, module.event.field.keyup);
                                    module.submit(event);
                                    module.debug('Enter pressed on input submitting form');
                                }
                                keyHeldDown = true;
                            }
                        },
                        keyup: function () {
                            keyHeldDown = false;
                        },
                        invalid: function (event) {
                            event.preventDefault();
                        },
                        blur: function (event) {
                            var
                                $field          = $(this),
                                validationRules = module.get.validation($field) || {},
                                identifier      = module.get.identifier(validationRules, $field)
                            ;
                            if (settings.on === 'blur' || (!$module.hasClass(className.initial) && settings.revalidate)) {
                                module.debug('Revalidating field', $field, validationRules);
                                module.validate.field(validationRules, identifier);
                                if (!settings.inline) {
                                    module.validate.form(false, true);
                                }
                            }
                        },
                        change: function (event) {
                            var
                                $field      = $(this),
                                validationRules = module.get.validation($field) || {},
                                identifier = module.get.identifier(validationRules, $field)
                            ;
                            if (settings.on === 'change' || (!$module.hasClass(className.initial) && settings.revalidate)) {
                                clearTimeout(module.timer);
                                module.timer = setTimeout(function () {
                                    module.debug('Revalidating field', $field, validationRules);
                                    module.validate.field(validationRules, identifier);
                                    if (!settings.inline) {
                                        module.validate.form(false, true);
                                    }
                                }, settings.delay);
                            }
                        },
                    },
                    beforeUnload: function (event) {
                        if (module.is.dirty() && !submitting) {
                            event = event || window.event;

                            // For modern browsers
                            if (event) {
                                event.returnValue = settings.text.leavingMessage;
                            }

                            // For olders...
                            return settings.text.leavingMessage;
                        }
                    },

                },

                get: {
                    ancillaryValue: function (rule) {
                        if (!rule.type || (!rule.value && !module.is.bracketedRule(rule))) {
                            return false;
                        }

                        return rule.value !== undefined
                            ? rule.value
                            : rule.type.match(settings.regExp.bracket)[1] + '';
                    },
                    ruleName: function (rule) {
                        if (module.is.bracketedRule(rule)) {
                            return rule.type.replace(rule.type.match(settings.regExp.bracket)[0], '');
                        }

                        return rule.type;
                    },
                    changeEvent: function (type, $input) {
                        return ['file', 'checkbox', 'radio', 'hidden'].indexOf(type) >= 0 || $input.is('select') ? 'change' : 'input';
                    },
                    fieldsFromShorthand: function (fields) {
                        var
                            fullFields = {}
                        ;
                        $.each(fields, function (name, rules) {
                            if (!Array.isArray(rules) && typeof rules === 'object') {
                                fullFields[name] = rules;
                            } else {
                                if (typeof rules === 'string') {
                                    rules = [rules];
                                }
                                fullFields[name] = {
                                    rules: [],
                                };
                                $.each(rules, function (index, rule) {
                                    fullFields[name].rules.push({ type: rule });
                                });
                            }

                            $.each(fullFields[name].rules, function (index, rule) {
                                var ruleName = module.get.ruleName(rule);
                                if (ruleName === 'empty') {
                                    module.warn('*** DEPRECATED *** : Rule "empty" for field "' + name + '" will be removed in a future version. -> Use "notEmpty" rule instead.');
                                }
                            });
                        });

                        return fullFields;
                    },
                    identifier: function (validation, $el) {
                        return validation.identifier || $el.attr('id') || $el.attr('name') || $el.data(metadata.validate);
                    },
                    prompt: function (rule, field) {
                        var
                            ruleName      = module.get.ruleName(rule),
                            ancillary     = module.get.ancillaryValue(rule),
                            $field        = module.get.field(field.identifier),
                            value         = $field.val(),
                            promptCheck   = rule.prompt || settings.prompt[ruleName] || settings.text.unspecifiedRule,
                            prompt        = String(isFunction(promptCheck)
                                ? promptCheck.call($field[0], value)
                                : promptCheck),
                            requiresValue = prompt.search('{value}') !== -1,
                            requiresName  = prompt.search('{name}') !== -1,
                            parts,
                            suffixPrompt
                        ;
                        if (ancillary && ['integer', 'decimal', 'number', 'size'].indexOf(ruleName) >= 0 && ancillary.indexOf('..') >= 0) {
                            parts = ancillary.split('..', 2);
                            if (!rule.prompt && ruleName !== 'size') {
                                suffixPrompt = parts[0] === ''
                                    ? settings.prompt.maxValue.replace(/{ruleValue}/g, '{max}')
                                    : (parts[1] === ''
                                        ? settings.prompt.minValue.replace(/{ruleValue}/g, '{min}')
                                        : settings.prompt.range);
                                prompt += suffixPrompt.replace(/{name}/g, ' ' + settings.text.and);
                            }
                            prompt = prompt.replace(/{min}/g, parts[0]);
                            prompt = prompt.replace(/{max}/g, parts[1]);
                        }
                        if (ancillary && ['match', 'different'].indexOf(ruleName) >= 0) {
                            prompt = prompt.replace(/{ruleValue}/g, module.get.fieldLabel(ancillary, true));
                        }
                        if (requiresValue) {
                            prompt = prompt.replace(/{value}/g, $field.val());
                        }
                        if (requiresName) {
                            prompt = prompt.replace(/{name}/g, module.get.fieldLabel($field));
                        }
                        prompt = prompt.replace(/{identifier}/g, field.identifier);
                        prompt = prompt.replace(/{ruleValue}/g, ancillary);
                        if (!rule.prompt) {
                            module.verbose('Using default validation prompt for type', prompt, ruleName);
                        }

                        return prompt;
                    },
                    settings: function () {
                        if ($.isPlainObject(parameters)) {
                            settings = $.extend(true, {}, $.fn.form.settings, parameters);
                            if (settings.fields) {
                                settings.fields = module.get.fieldsFromShorthand(settings.fields);
                            }
                            validation = $.extend(true, {}, $.fn.form.settings.defaults, settings.fields);
                            module.verbose('Extending settings', validation, settings);
                        } else {
                            settings = $.extend(true, {}, $.fn.form.settings);
                            validation = $.extend(true, {}, $.fn.form.settings.defaults);
                            module.verbose('Using default form validation', validation, settings);
                        }

                        // shorthand
                        namespace = settings.namespace;
                        metadata = settings.metadata;
                        selector = settings.selector;
                        className = settings.className;
                        regExp = settings.regExp;
                        error = settings.error;
                        moduleNamespace = 'module-' + namespace;
                        eventNamespace = '.' + namespace;

                        // grab instance
                        instance = $module.data(moduleNamespace);

                        // refresh selector cache
                        (instance || module).refresh();
                    },
                    field: function (identifier, strict, ignoreMissing) {
                        module.verbose('Finding field with identifier', identifier);
                        identifier = module.escape.string(identifier);
                        var t;
                        t = $field.filter('#' + identifier);
                        if (t.length > 0) {
                            return t;
                        }
                        t = $field.filter('[name="' + identifier + '"]');
                        if (t.length > 0) {
                            return t;
                        }
                        t = $field.filter('[name="' + identifier + '[]"]');
                        if (t.length > 0) {
                            return t;
                        }
                        t = $field.filter('[data-' + metadata.validate + '="' + identifier + '"]');
                        if (t.length > 0) {
                            return t;
                        }
                        if (!ignoreMissing) {
                            module.error(error.noField.replace('{identifier}', identifier));
                        }

                        return strict ? $() : $('<input/>');
                    },
                    fields: function (fields, strict) {
                        var
                            $fields = $()
                        ;
                        $.each(fields, function (index, name) {
                            $fields = $fields.add(module.get.field(name, strict));
                        });

                        return $fields;
                    },
                    fieldLabel: function (identifier, useIdAsFallback) {
                        var $field = typeof identifier === 'string'
                                ? module.get.field(identifier)
                                : identifier,
                            $label = $field.closest(selector.group).find('label:not(:empty)').eq(0)
                        ;

                        return $label.length === 1
                            ? $label.text()
                            : $field.prop('placeholder') || (useIdAsFallback ? identifier : settings.text.unspecifiedField);
                    },
                    validation: function ($field) {
                        var
                            fieldValidation,
                            identifier
                        ;
                        if (!validation) {
                            return false;
                        }
                        $.each(validation, function (fieldName, field) {
                            identifier = field.identifier || fieldName;
                            $.each(module.get.field(identifier), function (index, groupField) {
                                if (groupField == $field[0]) {
                                    field.identifier = identifier;
                                    fieldValidation = field;

                                    return false;
                                }
                            });
                        });

                        return fieldValidation || false;
                    },
                    value: function (field, strict) {
                        var
                            fields = [],
                            results,
                            resultKeys
                        ;
                        fields.push(field);
                        results = module.get.values.call(element, fields, strict);
                        resultKeys = Object.keys(results);

                        return resultKeys.length > 0 ? results[resultKeys[0]] : undefined;
                    },
                    values: function (fields, strict) {
                        var
                            $fields = Array.isArray(fields) && fields.length > 0
                                ? module.get.fields(fields, strict)
                                : $field,
                            values = {}
                        ;
                        $fields.each(function (index, field) {
                            var
                                $field       = $(field),
                                $calendar    = $field.closest(selector.uiCalendar),
                                name         = $field.prop('name') || $field.prop('id'),
                                value        = $field.val(),
                                isCheckbox   = $field.is(selector.checkbox),
                                isRadio      = $field.is(selector.radio),
                                isMultiple   = name.indexOf('[]') !== -1,
                                isCalendar   = $calendar.length > 0 && module.can.useElement('calendar'),
                                isChecked    = isCheckbox
                                    ? $field.is(':checked')
                                    : false
                            ;
                            if (name) {
                                if (isMultiple) {
                                    name = name.replace('[]', '');
                                    if (!values[name]) {
                                        values[name] = [];
                                    }
                                    if (isCheckbox) {
                                        if (isChecked) {
                                            values[name].push(value || true);
                                        } else {
                                            values[name].push(false);
                                        }
                                    } else {
                                        values[name].push(value);
                                    }
                                } else {
                                    if (isRadio) {
                                        if (values[name] === undefined || values[name] === false) {
                                            values[name] = isChecked
                                                ? value || true
                                                : false;
                                        }
                                    } else if (isCheckbox) {
                                        values[name] = isChecked ? value || true : false;
                                    } else if (isCalendar) {
                                        var date = $calendar.calendar('get date');

                                        if (date !== null) {
                                            switch (settings.dateHandling) {
                                                case 'date': {
                                                    values[name] = date;

                                                    break;
                                                }
                                                case 'input': {
                                                    values[name] = $calendar.calendar('get input date');

                                                    break;
                                                }
                                                case 'formatter': {
                                                    var type = $calendar.calendar('setting', 'type');

                                                    switch (type) {
                                                        case 'date': {
                                                            values[name] = settings.formatter.date(date);

                                                            break;
                                                        }
                                                        case 'datetime': {
                                                            values[name] = settings.formatter.datetime(date);

                                                            break;
                                                        }
                                                        case 'time': {
                                                            values[name] = settings.formatter.time(date);

                                                            break;
                                                        }
                                                        case 'month': {
                                                            values[name] = settings.formatter.month(date);

                                                            break;
                                                        }
                                                        case 'year': {
                                                            values[name] = settings.formatter.year(date);

                                                            break;
                                                        }
                                                        default: {
                                                            module.debug('Wrong calendar mode', $calendar, type);
                                                            values[name] = '';
                                                        }
                                                    }

                                                    break;
                                                }
                                            }
                                        } else {
                                            values[name] = '';
                                        }
                                    } else {
                                        values[name] = value;
                                    }
                                }
                            }
                        });

                        return values;
                    },
                    dirtyFields: function () {
                        return $field.filter(function (index, e) {
                            return $(e).data(metadata.isDirty);
                        });
                    },
                },

                has: {

                    field: function (identifier, ignoreMissing) {
                        module.verbose('Checking for existence of a field with identifier', identifier);

                        return module.get.field(identifier, true, ignoreMissing).length > 0;
                    },

                },

                can: {
                    useElement: function (element) {
                        if ($.fn[element] !== undefined) {
                            return true;
                        }
                        module.error(error.noElement.replace('{element}', element));

                        return false;
                    },
                },

                escape: {
                    string: function (text) {
                        text = String(text);

                        return text.replace(regExp.escape, '\\$&');
                    },
                },

                checkErrors: function (errors, internal) {
                    if (!errors || errors.length === 0) {
                        if (!internal) {
                            module.error(settings.error.noErrorMessage);
                        }

                        return false;
                    }
                    if (!internal) {
                        errors = typeof errors === 'string'
                            ? [errors]
                            : errors;
                    }

                    return errors;
                },
                add: {
                    // alias
                    rule: function (name, rules) {
                        module.add.field(name, rules);
                    },
                    field: function (name, rules) {
                        // Validation should have at least a standard format
                        if (validation[name] === undefined || validation[name].rules === undefined) {
                            validation[name] = {
                                rules: [],
                            };
                        }
                        var
                            newValidation = {
                                rules: [],
                            }
                        ;
                        if (module.is.shorthandRules(rules)) {
                            rules = Array.isArray(rules)
                                ? rules
                                : [rules];
                            $.each(rules, function (_index, rule) {
                                newValidation.rules.push({ type: rule });
                            });
                        } else {
                            newValidation.rules = rules.rules;
                        }
                        // For each new rule, check if there's not already one with the same type
                        $.each(newValidation.rules, function (_index, rule) {
                            if ($.grep(validation[name].rules, function (item) {
                                return item.type === rule.type;
                            }).length === 0) {
                                validation[name].rules.push(rule);
                            }
                        });
                        module.debug('Adding rules', newValidation.rules, validation);
                        module.refreshEvents();
                    },
                    fields: function (fields) {
                        validation = $.extend(true, {}, validation, module.get.fieldsFromShorthand(fields));
                        module.refreshEvents();
                    },
                    prompt: function (identifier, errors, internal) {
                        errors = module.checkErrors(errors);
                        if (errors === false) {
                            return;
                        }
                        var
                            $field       = module.get.field(identifier),
                            $fieldGroup  = $field.closest($group),
                            $prompt      = $fieldGroup.children(selector.prompt),
                            promptExists = $prompt.length > 0,
                            canTransition = settings.transition && module.can.useElement('transition')
                        ;
                        module.verbose('Adding field error state', identifier);
                        if (!internal) {
                            $fieldGroup
                                .addClass(className.error)
                            ;
                        }
                        if (settings.inline) {
                            if (promptExists) {
                                if (canTransition) {
                                    if ($prompt.transition('is animating')) {
                                        $prompt.transition('stop all');
                                    }
                                } else if ($prompt.is(':animated')) {
                                    $prompt.stop(true, true);
                                }
                                $prompt = $fieldGroup.children(selector.prompt);
                                promptExists = $prompt.length > 0;
                            }
                            if (!promptExists) {
                                $prompt = $('<div/>').addClass(className.label);
                                if (!canTransition) {
                                    $prompt.css('display', 'none');
                                }
                                $prompt
                                    .appendTo($fieldGroup.filter('.' + className.error))
                                ;
                            }
                            $prompt
                                .html(settings.templates.prompt(errors))
                            ;
                            if (!promptExists) {
                                if (canTransition) {
                                    module.verbose('Displaying error with css transition', settings.transition);
                                    $prompt.transition(settings.transition + ' in', settings.duration);
                                } else {
                                    module.verbose('Displaying error with fallback javascript animation');
                                    $prompt
                                        .fadeIn(settings.duration)
                                    ;
                                }
                            }
                        } else {
                            module.verbose('Inline errors are disabled, no inline error added', identifier);
                        }
                    },
                    errors: function (errors) {
                        errors = module.checkErrors(errors);
                        if (errors === false) {
                            return;
                        }
                        module.debug('Adding form error messages', errors);
                        module.set.error();
                        var customErrors = [],
                            tempErrors
                        ;
                        if ($.isPlainObject(errors)) {
                            $.each(Object.keys(errors), function (i, id) {
                                if (module.checkErrors(errors[id], true) !== false) {
                                    if (settings.inline) {
                                        module.add.prompt(id, errors[id]);
                                    } else {
                                        tempErrors = module.checkErrors(errors[id]);
                                        if (tempErrors !== false) {
                                            $.each(tempErrors, function (index, tempError) {
                                                customErrors.push(settings.prompt.addErrors
                                                    .replace(/{name}/g, module.get.fieldLabel(id))
                                                    .replace(/{error}/g, tempError));
                                            });
                                        }
                                    }
                                }
                            });
                        } else {
                            customErrors = errors;
                        }
                        if (customErrors.length > 0) {
                            $message
                                .html(settings.templates.error(customErrors))
                            ;
                        }
                    },
                },

                remove: {
                    errors: function () {
                        module.debug('Removing form error messages');
                        $message.empty();
                    },
                    states: function () {
                        $module.removeClass(className.error).removeClass(className.success).addClass(className.initial);
                        if (!settings.inline) {
                            module.remove.errors();
                        }
                        module.determine.isDirty();
                    },
                    rule: function (field, rule) {
                        var
                            rules = Array.isArray(rule)
                                ? rule
                                : [rule]
                        ;
                        if (validation[field] === undefined || !Array.isArray(validation[field].rules)) {
                            return;
                        }
                        if (rule === undefined) {
                            module.debug('Removed all rules');
                            if (module.has.field(field, true)) {
                                validation[field].rules = [];
                            } else {
                                delete validation[field];
                            }

                            return;
                        }
                        $.each(validation[field].rules, function (index, rule) {
                            if (rule && rules.indexOf(rule.type) !== -1) {
                                module.debug('Removed rule', rule.type);
                                validation[field].rules.splice(index, 1);
                            }
                        });
                    },
                    field: function (field) {
                        var
                            fields = Array.isArray(field)
                                ? field
                                : [field]
                        ;
                        $.each(fields, function (index, field) {
                            module.remove.rule(field);
                        });
                        module.refreshEvents();
                    },
                    // alias
                    rules: function (field, rules) {
                        if (Array.isArray(field)) {
                            $.each(field, function (index, field) {
                                module.remove.rule(field, rules);
                            });
                        } else {
                            module.remove.rule(field, rules);
                        }
                    },
                    fields: function (fields) {
                        module.remove.field(fields);
                    },
                    prompt: function (identifier) {
                        var
                            $field      = module.get.field(identifier),
                            $fieldGroup = $field.closest($group),
                            $prompt     = $fieldGroup.children(selector.prompt)
                        ;
                        $fieldGroup
                            .removeClass(className.error)
                        ;
                        if (settings.inline && $prompt.is(':visible')) {
                            module.verbose('Removing prompt for field', identifier);
                            if (settings.transition && module.can.useElement('transition')) {
                                $prompt.transition(settings.transition + ' out', settings.duration, function () {
                                    $prompt.remove();
                                });
                            } else {
                                $prompt
                                    .fadeOut(settings.duration, function () {
                                        $prompt.remove();
                                    })
                                ;
                            }
                        }
                    },
                },

                set: {
                    success: function () {
                        $module
                            .removeClass(className.error)
                            .addClass(className.success)
                        ;
                    },
                    defaults: function () {
                        $field.each(function (index, el) {
                            var
                                $el        = $(el),
                                $parent    = $el.parent(),
                                isCheckbox = $el.filter(selector.checkbox).length > 0,
                                isDropdown = ($parent.is(selector.uiDropdown) || $el.is(selector.uiDropdown)) && module.can.useElement('dropdown'),
                                $calendar  = $el.closest(selector.uiCalendar),
                                isCalendar = $calendar.length > 0 && module.can.useElement('calendar'),
                                value      = isCheckbox
                                    ? $el.is(':checked')
                                    : $el.val()
                            ;
                            if (isDropdown) {
                                if ($parent.is(selector.uiDropdown)) {
                                    $parent.dropdown('save defaults');
                                } else {
                                    $el.dropdown('save defaults');
                                }
                            } else if (isCalendar) {
                                $calendar.calendar('refresh');
                            }
                            $el.data(metadata.defaultValue, value);
                            $el.data(metadata.isDirty, false);
                        });
                    },
                    error: function () {
                        $module
                            .removeClass(className.success)
                            .addClass(className.error)
                        ;
                    },
                    value: function (field, value) {
                        var
                            fields = {}
                        ;
                        fields[field] = value;

                        return module.set.values.call(element, fields);
                    },
                    values: function (fields) {
                        if ($.isEmptyObject(fields)) {
                            return;
                        }
                        $.each(fields, function (key, value) {
                            var
                                $field      = module.get.field(key),
                                $element    = $field.parent(),
                                $calendar   = $field.closest(selector.uiCalendar),
                                isFile      = $field.is(selector.file),
                                isMultiple  = Array.isArray(value),
                                isCheckbox  = $element.is(selector.uiCheckbox) && module.can.useElement('checkbox'),
                                isDropdown  = $element.is(selector.uiDropdown) && module.can.useElement('dropdown'),
                                isRadio     = $field.is(selector.radio) && isCheckbox,
                                isCalendar  = $calendar.length > 0 && module.can.useElement('calendar'),
                                fieldExists = $field.length > 0,
                                $multipleField
                            ;
                            if (fieldExists) {
                                if (isMultiple && isCheckbox) {
                                    module.verbose('Selecting multiple', value, $field);
                                    $element.checkbox('uncheck');
                                    $.each(value, function (index, value) {
                                        $multipleField = $field.filter('[value="' + value + '"]');
                                        $element = $multipleField.parent();
                                        if ($multipleField.length > 0) {
                                            $element.checkbox('check');
                                        }
                                    });
                                } else if (isRadio) {
                                    module.verbose('Selecting radio value', value, $field);
                                    $field.filter('[value="' + value + '"]')
                                        .parent(selector.uiCheckbox)
                                        .checkbox('check')
                                    ;
                                } else if (isCheckbox) {
                                    module.verbose('Setting checkbox value', value, $element);
                                    if (value === true || value === 1 || value === 'on') {
                                        $element.checkbox('check');
                                    } else {
                                        $element.checkbox('uncheck');
                                    }
                                    if (typeof value === 'string') {
                                        $field.val(value);
                                    }
                                } else if (isDropdown) {
                                    module.verbose('Setting dropdown value', value, $element);
                                    $element.dropdown('set selected', value);
                                } else if (isCalendar) {
                                    $calendar.calendar('set date', value);
                                } else {
                                    module.verbose('Setting field value', value, $field);
                                    $field.val(isFile ? '' : value);
                                }
                            }
                        });
                    },
                    dirty: function () {
                        module.verbose('Setting state dirty');
                        dirty = true;
                        history[0] = history[1];
                        history[1] = 'dirty';

                        if (module.is.justClean()) {
                            $module.trigger('dirty');
                        }
                    },
                    clean: function () {
                        module.verbose('Setting state clean');
                        dirty = false;
                        history[0] = history[1];
                        history[1] = 'clean';

                        if (module.is.justDirty()) {
                            $module.trigger('clean');
                        }
                    },
                    asClean: function () {
                        module.set.defaults();
                        module.set.clean();
                    },
                    asDirty: function () {
                        module.set.defaults();
                        module.set.dirty();
                    },
                    autoCheck: function () {
                        module.debug('Enabling auto check on required fields');
                        if (validation) {
                            $.each(validation, function (fieldName) {
                                if (!module.has.field(fieldName, true)) {
                                    module.verbose('Field not found, removing from validation', fieldName);
                                    module.remove.field(fieldName);
                                }
                            });
                        }
                        $field.each(function (_index, el) {
                            var
                                $el        = $(el),
                                $elGroup   = $el.closest($group),
                                isCheckbox = $el.filter(selector.checkbox).length > 0,
                                isRequired = $el.prop('required') || $elGroup.hasClass(className.required) || $elGroup.parent().hasClass(className.required),
                                isDisabled = $el.is(':disabled') || $elGroup.hasClass(className.disabled) || $elGroup.parent().hasClass(className.disabled),
                                validation = module.get.validation($el),
                                hasNotEmptyRule = validation
                                    ? $.grep(validation.rules, function (rule) {
                                        return ['notEmpty', 'checked', 'empty'].indexOf(rule.type) >= 0;
                                    }).length > 0
                                    : false,
                                identifier = module.get.identifier(validation, $el)
                            ;
                            if (isRequired && !isDisabled && !hasNotEmptyRule && identifier !== undefined) {
                                if (isCheckbox) {
                                    module.verbose("Adding 'checked' rule on field", identifier);
                                    module.add.rule(identifier, 'checked');
                                } else {
                                    module.verbose("Adding 'notEmpty' rule on field", identifier);
                                    module.add.rule(identifier, 'notEmpty');
                                }
                            }
                        });
                    },
                    optional: function (identifier, bool) {
                        bool = bool !== false;
                        $.each(validation, function (fieldName, field) {
                            if (identifier === fieldName || identifier === field.identifier) {
                                field.optional = bool;
                            }
                        });
                    },
                },

                validate: {

                    form: function (event, ignoreCallbacks) {
                        var values = module.get.values();

                        // input keydown event will fire submit repeatedly by browser default
                        if (keyHeldDown) {
                            return false;
                        }
                        $module.removeClass(className.initial);
                        // reset errors
                        formErrors = [];
                        formErrorsTracker = {};
                        if (module.determine.isValid()) {
                            module.debug('Form has no validation errors, submitting');
                            module.set.success();
                            if (!settings.inline) {
                                module.remove.errors();
                            }
                            if (ignoreCallbacks !== true) {
                                return settings.onSuccess.call(element, event, values);
                            }
                        } else {
                            module.debug('Form has errors');
                            submitting = false;
                            module.set.error();
                            if (!settings.inline) {
                                module.add.errors(formErrors);
                            }
                            // prevent ajax submit
                            if (event && $module.data('moduleApi') !== undefined) {
                                event.stopImmediatePropagation();
                            }
                            if (settings.errorFocus && ignoreCallbacks !== true) {
                                var
                                    $focusElement,
                                    hasTabIndex = true
                                ;
                                if (typeof settings.errorFocus === 'string') {
                                    $focusElement = $(document).find(settings.errorFocus);
                                    hasTabIndex = $focusElement.is('[tabindex]');
                                    // to be able to focus/scroll into non input elements we need a tabindex
                                    if (!hasTabIndex) {
                                        $focusElement.attr('tabindex', -1);
                                    }
                                } else {
                                    $focusElement = $group.filter('.' + className.error).first().find(selector.field);
                                }
                                $focusElement.trigger('focus');
                                // only remove tabindex if it was dynamically created above
                                if (!hasTabIndex) {
                                    $focusElement.removeAttr('tabindex');
                                }
                            }
                            if (ignoreCallbacks !== true) {
                                return settings.onFailure.call(element, formErrors, values);
                            }
                        }
                    },

                    // takes a validation object and returns whether field passes validation
                    field: function (field, fieldName, showErrors) {
                        showErrors = showErrors !== undefined
                            ? showErrors
                            : true;
                        if (typeof field === 'string') {
                            module.verbose('Validating field', field);
                            fieldName = field;
                            field = validation[field];
                        }
                        if (!field) {
                            module.debug('Unable to find field validation. Skipping', fieldName);

                            return true;
                        }
                        var
                            identifier    = field.identifier || fieldName,
                            $field        = module.get.field(identifier),
                            $fieldGroup = $field.closest($group),
                            $dependsField = field.depends
                                ? module.get.field(field.depends)
                                : false,
                            fieldValid  = true,
                            fieldErrors = [],
                            isDisabled = $field.filter(':not(:disabled)').length === 0 || $fieldGroup.hasClass(className.disabled) || $fieldGroup.parent().hasClass(className.disabled),
                            validationMessage = $field[0].validationMessage,
                            noNativeValidation = field.noNativeValidation || settings.noNativeValidation || $field.filter('[formnovalidate],[novalidate]').length > 0 || $module.filter('[novalidate]').length > 0,
                            errorLimit
                        ;
                        if (!field.identifier) {
                            module.debug('Using field name as identifier', identifier);
                            field.identifier = identifier;
                        }
                        if (validationMessage && !noNativeValidation && !isDisabled) {
                            module.debug('Field is natively invalid', identifier);
                            fieldErrors.push(validationMessage);
                            fieldValid = false;
                            if (showErrors) {
                                $fieldGroup.addClass(className.error);
                            }
                        } else if (showErrors) {
                            $fieldGroup.removeClass(className.error);
                        }
                        if (isDisabled) {
                            module.debug('Field is disabled. Skipping', identifier);
                        } else if (field.optional && module.is.blank($field)) {
                            module.debug('Field is optional and blank. Skipping', identifier);
                        } else if (field.depends && module.is.empty($dependsField)) {
                            module.debug('Field depends on another value that is not present or empty. Skipping', $dependsField);
                        } else if (field.rules !== undefined) {
                            errorLimit = field.errorLimit || settings.errorLimit;
                            $.each(field.rules, function (index, rule) {
                                if (module.has.field(identifier) && (!errorLimit || fieldErrors.length < errorLimit)) {
                                    var invalidFields = module.validate.rule(field, rule, true) || [];
                                    if (invalidFields.length > 0) {
                                        module.debug('Field is invalid', identifier, rule.type);
                                        var fieldError = module.get.prompt(rule, field);
                                        if (!settings.inline) {
                                            if (
                                                // Always allow the first error prompt for new field identifiers
                                                (!(identifier in formErrorsTracker)
                                                // Also allow multiple error prompts per field identifier but make sure each prompt is unique
                                                || formErrorsTracker[identifier].indexOf(fieldError) === -1)
                                                // Limit the number of unique error prompts for every field identifier if specified
                                                && (!errorLimit || (formErrorsTracker[identifier] || []).length < errorLimit)
                                            ) {
                                                fieldErrors.push(fieldError);
                                                (formErrorsTracker[identifier] = formErrorsTracker[identifier] || []).push(fieldError);
                                            }
                                        } else {
                                            fieldErrors.push(fieldError);
                                        }
                                        fieldValid = false;
                                        if (showErrors) {
                                            $(invalidFields).closest($group).addClass(className.error);
                                        }
                                    }
                                }
                            });
                        }
                        if (fieldValid) {
                            if (showErrors) {
                                module.remove.prompt(identifier);
                                settings.onValid.call($field);
                            }
                        } else {
                            if (showErrors && fieldErrors.length > 0) {
                                formErrors = formErrors.concat(fieldErrors);
                                module.add.prompt(identifier, fieldErrors, true);
                                settings.onInvalid.call($field, fieldErrors);
                            }

                            return false;
                        }

                        return true;
                    },

                    // takes validation rule and returns whether field passes rule
                    rule: function (field, rule, internal) {
                        var
                            $field       = module.get.field(field.identifier),
                            ancillary    = module.get.ancillaryValue(rule),
                            ruleName     = module.get.ruleName(rule),
                            ruleFunction = settings.rules[ruleName],
                            invalidFields = [],
                            isCheckbox = $field.is(selector.checkbox),
                            isValid = function (field) {
                                var value = isCheckbox ? $(field).filter(':checked').val() : $(field).val();
                                // cast to string avoiding encoding special values
                                value = value === undefined || value === '' || value === null
                                    ? ''
                                    : ((settings.shouldTrim && rule.shouldTrim !== false) || rule.shouldTrim
                                        ? String(value + '').trim()
                                        : String(value + ''));

                                return ruleFunction.call(field, value, ancillary, module);
                            }
                        ;
                        if (!isFunction(ruleFunction)) {
                            module.error(error.noRule, ruleName);

                            return;
                        }
                        if (isCheckbox) {
                            if (!isValid($field)) {
                                invalidFields = $field;
                            }
                        } else {
                            $.each($field, function (index, field) {
                                if (!isValid(field)) {
                                    invalidFields.push(field);
                                }
                            });
                        }

                        return internal ? invalidFields : invalidFields.length === 0;
                    },
                },

                setting: function (name, value) {
                    if ($.isPlainObject(name)) {
                        $.extend(true, settings, name);
                    } else if (value !== undefined) {
                        settings[name] = value;
                    } else {
                        return settings[name];
                    }
                },
                internal: function (name, value) {
                    if ($.isPlainObject(name)) {
                        $.extend(true, module, name);
                    } else if (value !== undefined) {
                        module[name] = value;
                    } else {
                        return module[name];
                    }
                },
                debug: function () {
                    if (!settings.silent && settings.debug) {
                        if (settings.performance) {
                            module.performance.log(arguments);
                        } else {
                            module.debug = Function.prototype.bind.call(console.info, console, settings.name + ':');
                            module.debug.apply(console, arguments);
                        }
                    }
                },
                verbose: function () {
                    if (!settings.silent && settings.verbose && settings.debug) {
                        if (settings.performance) {
                            module.performance.log(arguments);
                        } else {
                            module.verbose = Function.prototype.bind.call(console.info, console, settings.name + ':');
                            module.verbose.apply(console, arguments);
                        }
                    }
                },
                error: function () {
                    if (!settings.silent) {
                        module.error = Function.prototype.bind.call(console.error, console, settings.name + ':');
                        module.error.apply(console, arguments);
                    }
                },
                warn: function () {
                    if (!settings.silent) {
                        module.warn = Function.prototype.bind.call(console.warn, console, settings.name + ':');
                        module.warn.apply(console, arguments);
                    }
                },
                performance: {
                    log: function (message) {
                        var
                            currentTime,
                            executionTime,
                            previousTime
                        ;
                        if (settings.performance) {
                            currentTime = Date.now();
                            previousTime = time || currentTime;
                            executionTime = currentTime - previousTime;
                            time = currentTime;
                            performance.push({
                                Name: message[0],
                                Arguments: [].slice.call(message, 1) || '',
                                Element: element,
                                'Execution Time': executionTime,
                            });
                        }
                        clearTimeout(module.performance.timer);
                        module.performance.timer = setTimeout(function () {
                            module.performance.display();
                        }, 500);
                    },
                    display: function () {
                        var
                            title = settings.name + ':',
                            totalTime = 0
                        ;
                        time = false;
                        clearTimeout(module.performance.timer);
                        $.each(performance, function (index, data) {
                            totalTime += data['Execution Time'];
                        });
                        title += ' ' + totalTime + 'ms';
                        if ($allModules.length > 1) {
                            title += ' (' + $allModules.length + ')';
                        }
                        if (performance.length > 0) {
                            console.groupCollapsed(title);
                            if (console.table) {
                                console.table(performance);
                            } else {
                                $.each(performance, function (index, data) {
                                    console.log(data.Name + ': ' + data['Execution Time'] + 'ms');
                                });
                            }
                            console.groupEnd();
                        }
                        performance = [];
                    },
                },
                invoke: function (query, passedArguments, context) {
                    var
                        object = instance,
                        maxDepth,
                        found,
                        response
                    ;
                    passedArguments = passedArguments || queryArguments;
                    context = context || element;
                    if (typeof query === 'string' && object !== undefined) {
                        query = query.split(/[ .]/);
                        maxDepth = query.length - 1;
                        $.each(query, function (depth, value) {
                            var camelCaseValue = depth !== maxDepth
                                ? value + query[depth + 1].charAt(0).toUpperCase() + query[depth + 1].slice(1)
                                : query;
                            if ($.isPlainObject(object[camelCaseValue]) && (depth !== maxDepth)) {
                                object = object[camelCaseValue];
                            } else if (object[camelCaseValue] !== undefined) {
                                found = object[camelCaseValue];

                                return false;
                            } else if ($.isPlainObject(object[value]) && (depth !== maxDepth)) {
                                object = object[value];
                            } else if (object[value] !== undefined) {
                                found = object[value];

                                return false;
                            } else {
                                module.error(error.method, query);

                                return false;
                            }
                        });
                    }
                    if (isFunction(found)) {
                        response = found.apply(context, passedArguments);
                    } else if (found !== undefined) {
                        response = found;
                    }
                    if (Array.isArray(returnedValue)) {
                        returnedValue.push(response);
                    } else if (returnedValue !== undefined) {
                        returnedValue = [returnedValue, response];
                    } else if (response !== undefined) {
                        returnedValue = response;
                    }

                    return found;
                },
            };
            module.initialize();
        });

        return returnedValue !== undefined
            ? returnedValue
            : this;
    };

    $.fn.form.settings = {

        name: 'Form',
        namespace: 'form',

        silent: false,
        debug: false,
        verbose: false,
        performance: true,

        fields: false,

        keyboardShortcuts: true,
        on: 'submit',
        inline: false,

        delay: 200,
        revalidate: true,
        shouldTrim: true,

        transition: 'scale',
        duration: 200,

        autoCheckRequired: false,
        preventLeaving: false,
        errorFocus: true,
        dateHandling: 'date', // 'date', 'input', 'formatter'
        errorLimit: 0,
        noNativeValidation: false,

        onValid: function () {},
        onInvalid: function () {},
        onSuccess: function () {
            return true;
        },
        onFailure: function () {
            return false;
        },
        onDirty: function () {},
        onClean: function () {},

        metadata: {
            defaultValue: 'default',
            validate: 'validate',
            isDirty: 'isDirty',
        },

        regExp: {
            htmlID: /^[A-Za-z][\w.:-]*$/g,
            bracket: /\[(.*)]/i,
            decimal: /^\d+\.?\d*$/,
            email: /^[\w!#$%&'*+./=?^`{|}~-]+@[\da-z]([\da-z-]*[\da-z])?(\.[\da-z]([\da-z-]*[\da-z])?)*$/i,
            escape: /[$()*+,./:=?@[\\\]^{|}-]/g,
            flags: /^\/(.*)\/(.*)?/,
            integer: /^-?\d+$/,
            number: /^-?\d*(\.\d+)?$/,
            url: /(https?:\/\/(?:www\.|(?!www))[^\s.]+\.\S{2,}|www\.\S+\.\S{2,})/i,
        },

        text: {
            and: 'and',
            unspecifiedRule: 'Please enter a valid value',
            unspecifiedField: 'This field',
            leavingMessage: 'There are unsaved changes on this page which will be discarded if you continue.',
        },

        prompt: {
            range: '{name} must be in a range from {min} to {max}',
            maxValue: '{name} must have a maximum value of {ruleValue}',
            minValue: '{name} must have a minimum value of {ruleValue}',
            empty: '{name} must have a value',
            notEmpty: '{name} must have a value',
            checked: '{name} must be checked',
            email: '{name} must be a valid e-mail',
            url: '{name} must be a valid url',
            regExp: '{name} is not formatted correctly',
            integer: '{name} must be an integer',
            decimal: '{name} must be a decimal number',
            number: '{name} must be set to a number',
            is: '{name} must be "{ruleValue}"',
            isExactly: '{name} must be exactly "{ruleValue}"',
            not: '{name} cannot be set to "{ruleValue}"',
            notExactly: '{name} cannot be set to exactly "{ruleValue}"',
            contains: '{name} must contain "{ruleValue}"',
            containsExactly: '{name} must contain exactly "{ruleValue}"',
            doesntContain: '{name} cannot contain "{ruleValue}"',
            doesntContainExactly: '{name} cannot contain exactly "{ruleValue}"',
            minLength: '{name} must be at least {ruleValue} characters',
            exactLength: '{name} must be exactly {ruleValue} characters',
            maxLength: '{name} cannot be longer than {ruleValue} characters',
            size: '{name} must have a length between {min} and {max} characters',
            match: '{name} must match {ruleValue} field',
            different: '{name} must have a different value than {ruleValue} field',
            creditCard: '{name} must be a valid credit card number',
            minCount: '{name} must have at least {ruleValue} choices',
            exactCount: '{name} must have exactly {ruleValue} choices',
            maxCount: '{name} must have {ruleValue} or less choices',
            addErrors: '{name}: {error}',
        },

        selector: {
            checkbox: 'input[type="checkbox"], input[type="radio"]',
            clear: '.clear',
            field: 'input:not(.search):not([type="reset"]):not([type="button"]):not([type="submit"]), textarea, select',
            file: 'input[type="file"]',
            group: '.field',
            input: 'input',
            message: '.error.message',
            prompt: '.prompt.label',
            radio: 'input[type="radio"]',
            reset: '.reset:not([type="reset"])',
            submit: '.submit:not([type="submit"])',
            uiCheckbox: '.ui.checkbox',
            uiDropdown: '.ui.dropdown',
            uiCalendar: '.ui.calendar',
        },

        className: {
            initial: 'initial',
            error: 'error',
            label: 'ui basic red pointing prompt label',
            pressed: 'down',
            success: 'success',
            required: 'required',
            disabled: 'disabled',
        },

        error: {
            method: 'The method you called is not defined.',
            noRule: 'There is no rule matching the one you specified',
            noField: 'Field identifier {identifier} not found',
            noElement: 'This module requires ui {element}',
            noErrorMessage: 'No error message provided',
        },

        templates: {

            // template that produces error message
            error: function (errors) {
                var
                    html = '<ul class="list">'
                ;
                $.each(errors, function (index, value) {
                    html += '<li>' + value + '</li>';
                });
                html += '</ul>';

                return html;
            },

            // template that produces label content
            prompt: function (errors) {
                if (errors.length === 1) {
                    return errors[0];
                }
                var
                    html = '<ul class="ui list">'
                ;
                $.each(errors, function (index, value) {
                    html += '<li>' + value + '</li>';
                });
                html += '</ul>';

                return html;
            },
        },

        formatter: {
            date: function (date) {
                return Intl.DateTimeFormat('en-GB').format(date);
            },
            datetime: function (date) {
                return Intl.DateTimeFormat('en-GB', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                }).format(date);
            },
            time: function (date) {
                return Intl.DateTimeFormat('en-GB', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                }).format(date);
            },
            month: function (date) {
                return Intl.DateTimeFormat('en-GB', {
                    month: '2-digit',
                    year: 'numeric',
                }).format(date);
            },
            year: function (date) {
                return Intl.DateTimeFormat('en-GB', {
                    year: 'numeric',
                }).format(date);
            },
        },

        rules: {

            // is not empty or blank string
            notEmpty: function (value) {
                return !(value === undefined || value === '' || (Array.isArray(value) && value.length === 0));
            },

            /* Deprecated */
            empty: function (value) {
                return $.fn.form.settings.rules.notEmpty(value);
            },

            // checkbox checked
            checked: function () {
                return $(this).filter(':checked').length > 0;
            },

            // is most likely an email
            email: function (value) {
                return $.fn.form.settings.regExp.email.test(value);
            },

            // value is most likely url
            url: function (value) {
                return $.fn.form.settings.regExp.url.test(value);
            },

            // matches specified regExp
            regExp: function (value, regExp) {
                if (regExp instanceof RegExp) {
                    return value.match(regExp);
                }
                var
                    regExpParts = regExp.match($.fn.form.settings.regExp.flags),
                    flags
                ;
                // regular expression specified as /baz/gi (flags)
                if (regExpParts) {
                    regExp = regExpParts.length >= 2
                        ? regExpParts[1]
                        : regExp;
                    flags = regExpParts.length >= 3
                        ? regExpParts[2]
                        : '';
                }

                return value.match(new RegExp(regExp, flags));
            },
            minValue: function (value, range) {
                return $.fn.form.settings.rules.range(value, range + '..', 'number');
            },
            maxValue: function (value, range) {
                return $.fn.form.settings.rules.range(value, '..' + range, 'number');
            },
            // is valid integer or matches range
            integer: function (value, range) {
                return $.fn.form.settings.rules.range(value, range, 'integer');
            },
            range: function (value, range, regExp, testLength) {
                if (typeof regExp === 'string') {
                    regExp = $.fn.form.settings.regExp[regExp];
                }
                if (!(regExp instanceof RegExp)) {
                    regExp = $.fn.form.settings.regExp.integer;
                }
                var
                    min,
                    max,
                    parts
                ;
                if (!range || ['', '..'].indexOf(range) !== -1) {

                    // do nothing
                } else if (range.indexOf('..') === -1) {
                    if (regExp.test(range)) {
                        min = range - 0;
                        max = min;
                    }
                } else {
                    parts = range.split('..', 2);
                    if (regExp.test(parts[0])) {
                        min = parts[0] - 0;
                    }
                    if (regExp.test(parts[1])) {
                        max = parts[1] - 0;
                    }
                }
                if (testLength) {
                    value = value.length;
                }

                return (
                    regExp.test(value)
                        && (min === undefined || value >= min)
                        && (max === undefined || value <= max)
                );
            },

            // is valid number (with decimal)
            decimal: function (value, range) {
                return $.fn.form.settings.rules.range(value, range, 'decimal');
            },

            // is valid number
            number: function (value, range) {
                return $.fn.form.settings.rules.range(value, range, 'number');
            },

            // is value (case insensitive)
            is: function (value, text) {
                text = typeof text === 'string'
                    ? text.toLowerCase()
                    : text;
                value = typeof value === 'string'
                    ? value.toLowerCase()
                    : value;

                return value == text;
            },

            // is value
            isExactly: function (value, text) {
                return value == text;
            },

            // value is not another value (case insensitive)
            not: function (value, notValue) {
                value = typeof value === 'string'
                    ? value.toLowerCase()
                    : value;
                notValue = typeof notValue === 'string'
                    ? notValue.toLowerCase()
                    : notValue;

                return value != notValue;
            },

            // value is not another value (case sensitive)
            notExactly: function (value, notValue) {
                return value != notValue;
            },

            // value contains text (insensitive)
            contains: function (value, text) {
                // escape regex characters
                text = text.replace($.fn.form.settings.regExp.escape, '\\$&');

                return value.search(new RegExp(text, 'i')) !== -1;
            },

            // value contains text (case sensitive)
            containsExactly: function (value, text) {
                // escape regex characters
                text = text.replace($.fn.form.settings.regExp.escape, '\\$&');

                return value.search(new RegExp(text)) !== -1;
            },

            // value contains text (insensitive)
            doesntContain: function (value, text) {
                // escape regex characters
                text = text.replace($.fn.form.settings.regExp.escape, '\\$&');

                return value.search(new RegExp(text, 'i')) === -1;
            },

            // value contains text (case sensitive)
            doesntContainExactly: function (value, text) {
                // escape regex characters
                text = text.replace($.fn.form.settings.regExp.escape, '\\$&');

                return value.search(new RegExp(text)) === -1;
            },

            // is at least string length
            minLength: function (value, minLength) {
                return $.fn.form.settings.rules.range(value, minLength + '..', 'integer', true);
            },

            // is exactly length
            exactLength: function (value, requiredLength) {
                return $.fn.form.settings.rules.range(value, requiredLength + '..' + requiredLength, 'integer', true);
            },

            // is less than length
            maxLength: function (value, maxLength) {
                return $.fn.form.settings.rules.range(value, '..' + maxLength, 'integer', true);
            },

            size: function (value, range) {
                return $.fn.form.settings.rules.range(value, range, 'integer', true);
            },

            // matches another field
            match: function (value, identifier, module) {
                var matchingValue = module.get.value(identifier, true);

                return matchingValue !== undefined
                    ? value.toString() === matchingValue.toString()
                    : false;
            },

            // different than another field
            different: function (value, identifier, module) {
                var matchingValue = module.get.value(identifier, true);

                return matchingValue !== undefined
                    ? value.toString() !== matchingValue.toString()
                    : false;
            },

            creditCard: function (cardNumber, cardTypes) {
                var
                    cards = {
                        visa: {
                            pattern: /^4/,
                            length: [16],
                        },
                        amex: {
                            pattern: /^3[47]/,
                            length: [15],
                        },
                        mastercard: {
                            pattern: /^5[1-5]/,
                            length: [16],
                        },
                        discover: {
                            pattern: /^(6011|622(12[6-9]|1[3-9]\d|[2-8]\d{2}|9[01]\d|92[0-5]|64[4-9])|65)/,
                            length: [16],
                        },
                        unionPay: {
                            pattern: /^(62|88)/,
                            length: [16, 17, 18, 19],
                        },
                        jcb: {
                            pattern: /^35(2[89]|[3-8]\d)/,
                            length: [16],
                        },
                        maestro: {
                            pattern: /^(5018|5020|5038|6304|6759|676[1-3])/,
                            length: [12, 13, 14, 15, 16, 17, 18, 19],
                        },
                        dinersClub: {
                            pattern: /^(30[0-5]|^36)/,
                            length: [14],
                        },
                        laser: {
                            pattern: /^(6304|670[69]|6771)/,
                            length: [16, 17, 18, 19],
                        },
                        visaElectron: {
                            pattern: /^(4026|417500|4508|4844|491(3|7))/,
                            length: [16],
                        },
                    },
                    valid         = {},
                    validCard     = false,
                    requiredTypes = typeof cardTypes === 'string'
                        ? cardTypes.split(',')
                        : false,
                    unionPay,
                    validation
                ;

                if (typeof cardNumber !== 'string' || cardNumber.length === 0) {
                    return;
                }

                // allow dashes and spaces in card
                cardNumber = cardNumber.replace(/[\s-]/g, '');

                // verify card types
                if (requiredTypes) {
                    $.each(requiredTypes, function (index, type) {
                        // verify each card type
                        validation = cards[type];
                        if (validation) {
                            valid = {
                                length: $.inArray(cardNumber.length, validation.length) !== -1,
                                pattern: cardNumber.search(validation.pattern) !== -1,
                            };
                            if (valid.length > 0 && valid.pattern) {
                                validCard = true;
                            }
                        }
                    });

                    if (!validCard) {
                        return false;
                    }
                }

                // skip luhn for UnionPay
                unionPay = {
                    number: $.inArray(cardNumber.length, cards.unionPay.length) !== -1,
                    pattern: cardNumber.search(cards.unionPay.pattern) !== -1,
                };
                if (unionPay.number && unionPay.pattern) {
                    return true;
                }

                // verify luhn, adapted from  <https://gist.github.com/2134376>
                var
                    length        = cardNumber.length,
                    multiple      = 0,
                    producedValue = [
                        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
                        [0, 2, 4, 6, 8, 1, 3, 5, 7, 9],
                    ],
                    sum           = 0
                ;
                while (length--) {
                    sum += producedValue[multiple][parseInt(cardNumber.charAt(length), 10)];
                    multiple ^= 1; // eslint-disable-line no-bitwise
                }

                return sum % 10 === 0 && sum > 0;
            },

            minCount: function (value, minCount) {
                minCount = Number(minCount);

                if (minCount === 0) {
                    return true;
                }
                if (minCount === 1) {
                    return value !== '';
                }

                return value.split(',').length >= minCount;
            },

            exactCount: function (value, exactCount) {
                exactCount = Number(exactCount);

                if (exactCount === 0) {
                    return value === '';
                }
                if (exactCount === 1) {
                    return value !== '' && value.search(',') === -1;
                }

                return value.split(',').length === exactCount;
            },

            maxCount: function (value, maxCount) {
                maxCount = Number(maxCount);

                if (maxCount === 0) {
                    return false;
                }
                if (maxCount === 1) {
                    return value.search(',') === -1;
                }

                return value.split(',').length <= maxCount;
            },
        },

    };
})(jQuery, window, document);

/*!
 * # Fomantic-UI 2.9.4 - Modal
 * https://github.com/fomantic/Fomantic-UI/
 *
 *
 * Released under the MIT license
 * https://opensource.org/licenses/MIT
 *
 */

(function ($, window, document) {
    'use strict';

    function isFunction(obj) {
        return typeof obj === 'function' && typeof obj.nodeType !== 'number';
    }

    window = window !== undefined && window.Math === Math
        ? window
        : globalThis;

    $.fn.modal = function (parameters) {
        var
            $allModules    = $(this),
            $window        = $(window),
            $document      = $(document),
            $body          = $('body'),

            time           = Date.now(),
            performance    = [],

            query          = arguments[0],
            methodInvoked  = typeof query === 'string',
            queryArguments = [].slice.call(arguments, 1),
            contextCheck   = function (context, win) {
                var $context;
                if ([window, document].indexOf(context) >= 0) {
                    $context = $body;
                } else {
                    $context = $(win.document).find(context);
                    if ($context.length === 0) {
                        $context = win.frameElement ? contextCheck(context, win.parent) : $body;
                    }
                }

                return $context;
            },
            returnedValue
        ;

        $allModules.each(function () {
            var
                settings    = $.isPlainObject(parameters)
                    ? $.extend(true, {}, $.fn.modal.settings, parameters)
                    : $.extend({}, $.fn.modal.settings),

                selector        = settings.selector,
                className       = settings.className,
                namespace       = settings.namespace,
                fields          = settings.fields,
                error           = settings.error,

                eventNamespace  = '.' + namespace,
                moduleNamespace = 'module-' + namespace,

                $module         = $(this),
                $context        = contextCheck(settings.context, window),
                isBody          = $context[0] === $body[0],
                $closeIcon      = $module.find(selector.closeIcon),
                $inputs,

                $allModals,
                $otherModals,
                $focusedElement,
                $dimmable,
                $dimmer,

                isModalComponent = $module.hasClass('modal'),

                element         = this,
                instance        = isModalComponent ? $module.data(moduleNamespace) : undefined,

                ignoreRepeatedEvents = false,

                initialMouseDownInModal,
                initialMouseDownInScrollbar,
                initialBodyMargin = '',
                tempBodyMargin = '',
                keepScrollingClass = false,
                hadScrollbar = false,
                windowRefocused = false,

                elementEventNamespace,
                id,
                observer,
                observeAttributes = false,
                module
            ;
            module = {

                initialize: function () {
                    module.create.id();
                    if (!isModalComponent) {
                        module.create.modal();
                        if (!isFunction(settings.onHidden)) {
                            settings.onHidden = function () {
                                module.destroy();
                                $module.remove();
                            };
                        }
                    }
                    $module.addClass(settings.class);
                    if (settings.title !== '') {
                        $module.find(selector.title).html(module.helpers.escape(settings.title, settings.preserveHTML)).addClass(settings.classTitle);
                    }
                    if (settings.content !== '') {
                        $module.find(selector.content).html(module.helpers.escape(settings.content, settings.preserveHTML)).addClass(settings.classContent);
                    }
                    if (module.has.configActions()) {
                        var $actions = $module.find(selector.actions).addClass(settings.classActions);
                        if ($actions.length === 0) {
                            $actions = $('<div/>', { class: className.actions + ' ' + (settings.classActions || '') }).appendTo($module);
                        } else {
                            $actions.empty();
                        }
                        settings.actions.forEach(function (el) {
                            var
                                icon = el[fields.icon]
                                    ? '<i ' + (el[fields.text] ? 'aria-hidden="true"' : '') + ' class="' + module.helpers.deQuote(el[fields.icon]) + ' icon"></i>'
                                    : '',
                                text = module.helpers.escape(el[fields.text] || '', settings.preserveHTML),
                                cls = module.helpers.deQuote(el[fields.class] || ''),
                                click = el[fields.click] && isFunction(el[fields.click])
                                    ? el[fields.click]
                                    : function () {}
                            ;
                            $actions.append($('<button/>', {
                                html: icon + text,
                                'aria-label': (el[fields.text] || el[fields.icon] || '').replace(/<[^>]+(>|$)/g, ''),
                                class: className.button + ' ' + cls,
                                on: {
                                    click: function () {
                                        var button = $(this);
                                        if (button.is(selector.approve) || button.is(selector.deny) || click.call(element, $module) === false) {
                                            return;
                                        }
                                        module.hide();
                                    },
                                },
                            }));
                        });
                    }
                    module.cache = {};
                    module.verbose('Initializing dimmer', $context);

                    module.create.dimmer();

                    if (settings.allowMultiple) {
                        module.create.innerDimmer();
                    }
                    if (!settings.centered) {
                        $module.addClass('top aligned');
                    }
                    module.refreshModals();
                    module.bind.events();
                    module.observeChanges();
                    module.instantiate();
                    if (settings.autoShow) {
                        module.show();
                    }
                },

                instantiate: function () {
                    module.verbose('Storing instance of modal');
                    instance = module;
                    $module
                        .data(moduleNamespace, instance)
                    ;
                },

                create: {
                    modal: function () {
                        $module = $('<div/>', { class: className.modal, role: 'dialog', 'aria-modal': true });
                        if (settings.closeIcon) {
                            $closeIcon = $('<i/>', {
                                class: className.close,
                                role: 'button',
                                tabindex: 0,
                                'aria-label': settings.text.close,
                            });
                            $module.append($closeIcon);
                        }
                        if (settings.title !== '') {
                            var titleId = '_' + module.get.id() + 'title';
                            $module.attr('aria-labelledby', titleId);
                            $('<div/>', { class: className.title, id: titleId }).appendTo($module);
                        }
                        if (settings.content !== '') {
                            var descId = '_' + module.get.id() + 'desc';
                            $module.attr('aria-describedby', descId);
                            $('<div/>', { class: className.content, id: descId }).appendTo($module);
                        }
                        if (module.has.configActions()) {
                            $('<div/>', { class: className.actions }).appendTo($module);
                        }
                        $context.append($module);
                        element = $module[0];
                    },
                    dimmer: function () {
                        var
                            defaultSettings = {
                                debug: settings.debug,
                                dimmerName: 'modals',
                            },
                            dimmerSettings = $.extend(true, defaultSettings, settings.dimmerSettings)
                        ;
                        if ($.fn.dimmer === undefined) {
                            module.error(error.dimmer);

                            return;
                        }
                        module.debug('Creating dimmer');
                        $dimmable = $context.dimmer(dimmerSettings);
                        keepScrollingClass = module.is.scrolling();
                        if (settings.detachable) {
                            module.verbose('Modal is detachable, moving content into dimmer');
                            $dimmable.dimmer('add content', $module);
                        } else {
                            module.set.undetached();
                        }
                        $dimmer = $dimmable.dimmer('get dimmer');
                    },
                    id: function () {
                        id = (Math.random().toString(16) + '000000000').slice(2, 10);
                        elementEventNamespace = '.' + id;
                        module.verbose('Creating unique id for element', id);
                    },
                    innerDimmer: function () {
                        if ($module.find(selector.dimmer).length === 0) {
                            $('<div/>', { class: className.innerDimmer }).prependTo($module);
                        }
                    },
                },

                destroy: function () {
                    if (observer) {
                        observer.disconnect();
                    }
                    module.verbose('Destroying previous modal');
                    $module
                        .removeData(moduleNamespace)
                        .off(eventNamespace)
                    ;
                    $window.off(elementEventNamespace);
                    $context.off(elementEventNamespace);
                    $dimmer.off(elementEventNamespace);
                    $closeIcon.off(elementEventNamespace);
                    if ($inputs) {
                        $inputs.off(elementEventNamespace);
                    }
                    $context.dimmer('destroy');
                },

                observeChanges: function () {
                    if ('MutationObserver' in window) {
                        observer = new MutationObserver(function (mutations) {
                            var collectNodes = function (parent) {
                                    var nodes = [];
                                    for (var c = 0, cl = parent.length; c < cl; c++) {
                                        Array.prototype.push.apply(nodes, collectNodes(parent[c].childNodes));
                                        nodes.push(parent[c]);
                                    }

                                    return nodes;
                                },
                                shouldRefresh = false,
                                shouldRefreshInputs = false,
                                ignoreAutofocus = true
                            ;
                            mutations.every(function (mutation) {
                                if (mutation.type === 'attributes') {
                                    if (observeAttributes && (mutation.attributeName === 'disabled' || $(mutation.target).find(':input').addBack(':input').filter(':visible').length > 0)) {
                                        shouldRefreshInputs = true;
                                    }
                                } else {
                                    shouldRefresh = true;
                                    // mutationobserver only provides the parent nodes
                                    // so let's collect all childs as well to find nested inputs
                                    var $addedInputs = $(collectNodes(mutation.addedNodes)).filter('a[href], [tabindex], :input:enabled').filter(':visible'),
                                        $removedInputs = $(collectNodes(mutation.removedNodes)).filter('a[href], [tabindex], :input');
                                    if ($addedInputs.length > 0 || $removedInputs.length > 0) {
                                        shouldRefreshInputs = true;
                                        if ($addedInputs.filter(':input').length > 0 || $removedInputs.filter(':input').length > 0) {
                                            ignoreAutofocus = false;
                                        }
                                    }
                                }

                                return !shouldRefreshInputs;
                            });

                            if (shouldRefresh && settings.observeChanges) {
                                module.debug('DOM tree modified, refreshing');
                                module.refresh();
                            }
                            if (shouldRefreshInputs) {
                                module.refreshInputs(ignoreAutofocus);
                            }
                        });
                        observer.observe(element, {
                            attributeFilter: ['class', 'disabled'],
                            attributes: true,
                            childList: true,
                            subtree: true,
                        });
                        module.debug('Setting up mutation observer', observer);
                    }
                },

                refresh: function () {
                    module.remove.scrolling();
                    module.cacheSizes();
                    if (!module.can.useFlex()) {
                        module.set.modalOffset();
                    }
                    module.set.screenHeight();
                    module.set.type();
                },

                refreshModals: function () {
                    $otherModals = $module.siblings(selector.modal);
                    $allModals = $otherModals.add($module);
                },

                refreshInputs: function (ignoreAutofocus) {
                    if ($inputs) {
                        $inputs
                            .off('keydown' + elementEventNamespace)
                        ;
                    }
                    $inputs = $module.find('a[href], [tabindex], :input:enabled').filter(':visible').filter(function () {
                        return $(this).closest('.disabled').length === 0;
                    });
                    if ($inputs.filter(':input').length === 0) {
                        $inputs = $module.add($inputs);
                        $module.attr('tabindex', -1);
                    } else {
                        $module.removeAttr('tabindex');
                    }
                    $inputs.first()
                        .on('keydown' + elementEventNamespace, module.event.inputKeyDown.first)
                    ;
                    $inputs.last()
                        .on('keydown' + elementEventNamespace, module.event.inputKeyDown.last)
                    ;
                    if (!ignoreAutofocus && settings.autofocus && $inputs.filter(':focus').length === 0) {
                        module.set.autofocus();
                    }
                },

                attachEvents: function (selector, event) {
                    var
                        $toggle = $(selector)
                    ;
                    event = isFunction(module[event])
                        ? module[event]
                        : module.toggle;
                    if ($toggle.length > 0) {
                        module.debug('Attaching modal events to element', selector, event);
                        $toggle
                            .off(eventNamespace)
                            .on('click' + eventNamespace, event)
                        ;
                    } else {
                        module.error(error.notFound, selector);
                    }
                },

                bind: {
                    events: function () {
                        module.verbose('Attaching events');
                        $module
                            .on('click' + eventNamespace, selector.close, module.event.close)
                            .on('click' + eventNamespace, selector.approve, module.event.approve)
                            .on('click' + eventNamespace, selector.deny, module.event.deny)
                        ;
                        $closeIcon
                            .on('keyup' + elementEventNamespace, module.event.closeKeyUp)
                        ;
                        $window
                            .on('resize' + elementEventNamespace, module.event.resize)
                            .on('focus' + elementEventNamespace, module.event.focus)
                        ;
                        $context
                            .on('click' + elementEventNamespace, module.event.click)
                        ;
                    },
                    scrollLock: function () {
                        // touch events default to passive, due to changes in chrome to optimize mobile perf
                        $dimmable[0].addEventListener('touchmove', module.event.preventScroll, { passive: false });
                    },
                },

                unbind: {
                    scrollLock: function () {
                        $dimmable[0].removeEventListener('touchmove', module.event.preventScroll, { passive: false });
                    },
                },

                get: {
                    id: function () {
                        return id;
                    },
                    element: function () {
                        return $module;
                    },
                    settings: function () {
                        return settings;
                    },
                },

                event: {
                    approve: function () {
                        if (ignoreRepeatedEvents || settings.onApprove.call(element, $(this)) === false) {
                            module.verbose('Approve callback returned false cancelling hide');

                            return;
                        }
                        ignoreRepeatedEvents = true;
                        module.hide(function () {
                            ignoreRepeatedEvents = false;
                        });
                    },
                    preventScroll: function (event) {
                        if (event.target.className.indexOf('dimmer') !== -1) {
                            event.preventDefault();
                        }
                    },
                    deny: function () {
                        if (ignoreRepeatedEvents || settings.onDeny.call(element, $(this)) === false) {
                            module.verbose('Deny callback returned false cancelling hide');

                            return;
                        }
                        ignoreRepeatedEvents = true;
                        module.hide(function () {
                            ignoreRepeatedEvents = false;
                        });
                    },
                    close: function () {
                        module.hide();
                    },
                    closeKeyUp: function (event) {
                        var
                            keyCode   = event.which
                        ;
                        if ((keyCode === settings.keys.enter || keyCode === settings.keys.space) && $module.hasClass(className.front)) {
                            module.hide();
                        }
                    },
                    inputKeyDown: {
                        first: function (event) {
                            var
                                keyCode = event.which
                            ;
                            if (keyCode === settings.keys.tab && event.shiftKey) {
                                $inputs.last().trigger('focus');
                                event.preventDefault();
                            }
                        },
                        last: function (event) {
                            var
                                keyCode = event.which
                            ;
                            if (keyCode === settings.keys.tab && !event.shiftKey) {
                                $inputs.first().trigger('focus');
                                event.preventDefault();
                            }
                        },
                    },
                    mousedown: function (event) {
                        var
                            $target   = $(event.target),
                            isRtl = module.is.rtl()
                        ;
                        initialMouseDownInModal = $target.closest(selector.modal).length > 0;
                        if (initialMouseDownInModal) {
                            module.verbose('Mouse down event registered inside the modal');
                        }
                        initialMouseDownInScrollbar = module.is.scrolling() && ((!isRtl && $window.outerWidth() - settings.scrollbarWidth <= event.clientX) || (isRtl && settings.scrollbarWidth >= event.clientX));
                        if (initialMouseDownInScrollbar) {
                            module.verbose('Mouse down event registered inside the scrollbar');
                        }
                    },
                    mouseup: function (event) {
                        if (!settings.closable) {
                            module.verbose('Dimmer clicked but closable setting is disabled');

                            return;
                        }
                        if (initialMouseDownInModal) {
                            module.debug('Dimmer clicked but mouse down was initially registered inside the modal');

                            return;
                        }
                        if (initialMouseDownInScrollbar) {
                            module.debug('Dimmer clicked but mouse down was initially registered inside the scrollbar');

                            return;
                        }
                        var
                            $target   = $(event.target),
                            isInModal = $target.closest(selector.modal).length > 0,
                            isInDOM   = $.contains(document.documentElement, event.target)
                        ;
                        if (!isInModal && isInDOM && module.is.active() && $module.hasClass(className.front)) {
                            module.debug('Dimmer clicked, hiding all modals');
                            if (settings.allowMultiple) {
                                if (!module.hideAll()) {
                                    return;
                                }
                            } else if (!module.hide()) {
                                return;
                            }
                            module.remove.clickaway();
                        }
                    },
                    debounce: function (method, delay) {
                        clearTimeout(module.timer);
                        module.timer = setTimeout(function () {
                            method();
                        }, delay);
                    },
                    keyboard: function (event) {
                        var
                            keyCode   = event.which
                        ;
                        if (keyCode === settings.keys.escape) {
                            if (settings.closable) {
                                module.debug('Escape key pressed hiding modal');
                                if ($module.hasClass(className.front)) {
                                    module.hide();
                                }
                            } else {
                                module.debug('Escape key pressed, but closable is set to false');
                            }
                            event.preventDefault();
                        }
                    },
                    resize: function () {
                        if ($dimmable.dimmer('is active') && (module.is.animating() || module.is.active())) {
                            requestAnimationFrame(module.refresh);
                        }
                    },
                    focus: function () {
                        windowRefocused = true;
                    },
                    click: function (event) {
                        if (windowRefocused && document.activeElement !== event.target && $dimmable.dimmer('is active') && module.is.active() && settings.autofocus && $(document.activeElement).closest(selector.modal).length === 0) {
                            requestAnimationFrame(module.set.autofocus);
                        }
                        windowRefocused = false;
                    },
                },

                toggle: function () {
                    if (module.is.active() || module.is.animating()) {
                        module.hide();
                    } else {
                        module.show();
                    }
                },

                show: function (callback) {
                    callback = isFunction(callback)
                        ? callback
                        : function () {};
                    module.refreshModals();
                    module.set.dimmerSettings();
                    module.set.dimmerStyles();

                    module.showModal(callback);
                },

                hide: function (callback) {
                    callback = isFunction(callback)
                        ? callback
                        : function () {};
                    module.refreshModals();

                    return module.hideModal(callback);
                },

                showModal: function (callback) {
                    callback = isFunction(callback)
                        ? callback
                        : function () {};
                    if (module.is.animating() || !module.is.active()) {
                        if (settings.onShow.call(element) === false) {
                            module.verbose('Show callback returned false cancelling show');

                            return;
                        }
                        hadScrollbar = module.has.scrollbar();
                        module.showDimmer();
                        module.cacheSizes();
                        if (hadScrollbar) {
                            module.set.bodyMargin();
                        }
                        if (module.can.useFlex()) {
                            module.remove.legacy();
                        } else {
                            module.set.legacy();
                            module.set.modalOffset();
                            module.debug('Using non-flex legacy modal positioning.');
                        }
                        module.set.screenHeight();
                        module.set.type();
                        module.set.clickaway();

                        if (!settings.allowMultiple && module.others.active()) {
                            module.hideOthers(module.showModal);
                        } else {
                            ignoreRepeatedEvents = false;
                            if (settings.allowMultiple) {
                                if (module.others.active()) {
                                    $otherModals.filter('.' + className.active).find(selector.dimmer).removeClass('out').addClass('transition fade in active');
                                }

                                if (settings.detachable) {
                                    $module.detach().appendTo($dimmer);
                                }
                            }
                            if (settings.transition && $.fn.transition !== undefined) {
                                module.debug('Showing modal with css animations');
                                module.set.observeAttributes(false);
                                $module
                                    .transition({
                                        debug: settings.debug,
                                        verbose: settings.verbose,
                                        silent: settings.silent,
                                        animation: (settings.transition.showMethod || settings.transition) + ' in',
                                        queue: settings.queue,
                                        duration: settings.transition.showDuration || settings.duration,
                                        useFailSafe: true,
                                        onComplete: function () {
                                            settings.onVisible.apply(element);
                                            if (settings.keyboardShortcuts) {
                                                module.add.keyboardShortcuts();
                                            }
                                            module.save.focus();
                                            module.set.active();
                                            module.refreshInputs();
                                            requestAnimationFrame(module.set.observeAttributes);
                                            callback();
                                        },
                                    })
                                ;
                            } else {
                                module.error(error.noTransition);
                            }
                        }
                    } else {
                        module.debug('Modal is already visible');
                    }
                },

                hideModal: function (callback, keepDimmed, hideOthersToo) {
                    var
                        $previousModal = $otherModals.filter('.' + className.active).last()
                    ;
                    callback = isFunction(callback)
                        ? callback
                        : function () {};
                    if (settings.onHide.call(element, $(this)) === false) {
                        module.verbose('Hide callback returned false cancelling hide');
                        ignoreRepeatedEvents = false;

                        return false;
                    }

                    if (module.is.animating() || module.is.active()) {
                        module.debug('Hiding modal');
                        if (settings.transition && $.fn.transition !== undefined) {
                            module.remove.active();
                            module.set.observeAttributes(false);
                            $module
                                .transition({
                                    debug: settings.debug,
                                    verbose: settings.verbose,
                                    silent: settings.silent,
                                    animation: (settings.transition.hideMethod || settings.transition) + ' out',
                                    queue: settings.queue,
                                    duration: settings.transition.hideDuration || settings.duration,
                                    useFailSafe: true,
                                    onStart: function () {
                                        if (!module.others.active() && !module.others.animating() && !keepDimmed) {
                                            module.hideDimmer();
                                        } else if (settings.allowMultiple) {
                                            (hideOthersToo ? $allModals : $previousModal).find(selector.dimmer).removeClass('in').addClass('out');
                                        }
                                        if (settings.keyboardShortcuts && !module.others.active()) {
                                            module.remove.keyboardShortcuts();
                                        }
                                    },
                                    onComplete: function () {
                                        module.unbind.scrollLock();
                                        module.remove.active();
                                        if (settings.allowMultiple) {
                                            $previousModal.addClass(className.front);
                                            $module.removeClass(className.front);

                                            (hideOthersToo ? $allModals : $previousModal).find(selector.dimmer).removeClass('active');
                                        }
                                        if (isFunction(settings.onHidden)) {
                                            settings.onHidden.call(element);
                                        }
                                        module.remove.dimmerStyles();
                                        module.restore.focus();
                                        callback();
                                    },
                                })
                            ;
                        } else {
                            module.error(error.noTransition);
                        }
                    }
                },

                showDimmer: function () {
                    if ($dimmable.dimmer('is animating') || !$dimmable.dimmer('is active')) {
                        if (hadScrollbar) {
                            if (!isBody) {
                                $dimmer.css('top', $dimmable.scrollTop());
                            }
                            module.save.bodyMargin();
                        }
                        module.debug('Showing dimmer');
                        $dimmable.dimmer('show');
                    } else {
                        module.debug('Dimmer already visible');
                    }
                },

                hideDimmer: function () {
                    if ($dimmable.dimmer('is animating') || $dimmable.dimmer('is active')) {
                        module.unbind.scrollLock();
                        $dimmable.dimmer('hide', function () {
                            if (hadScrollbar) {
                                module.restore.bodyMargin();
                            }
                            module.remove.clickaway();
                            module.remove.screenHeight();
                        });
                    } else {
                        module.debug('Dimmer is not visible cannot hide');
                    }
                },

                hideAll: function (callback) {
                    var
                        $visibleModals = $allModals.filter('.' + className.active + ', .' + className.animating)
                    ;
                    callback = isFunction(callback)
                        ? callback
                        : function () {};
                    if ($visibleModals.length > 0) {
                        module.debug('Hiding all visible modals');
                        var hideOk = true;
                        // check in reverse order trying to hide most top displayed modal first
                        $($visibleModals.get().reverse()).each(function (index, element) {
                            if (hideOk) {
                                hideOk = $(element).modal('hide modal', callback, false, true);
                            }
                        });
                        if (hideOk) {
                            module.hideDimmer();
                        }

                        return hideOk;
                    }
                },

                hideOthers: function (callback) {
                    var
                        $visibleModals = $otherModals.filter('.' + className.active + ', .' + className.animating)
                    ;
                    callback = isFunction(callback)
                        ? callback
                        : function () {};
                    if ($visibleModals.length > 0) {
                        module.debug('Hiding other modals', $otherModals);
                        $visibleModals
                            .modal('hide modal', callback, true)
                        ;
                    }
                },

                others: {
                    active: function () {
                        return $otherModals.filter('.' + className.active).length > 0;
                    },
                    animating: function () {
                        return $otherModals.filter('.' + className.animating).length > 0;
                    },
                },

                add: {
                    keyboardShortcuts: function () {
                        module.verbose('Adding keyboard shortcuts');
                        $document
                            .on('keydown' + eventNamespace, module.event.keyboard)
                        ;
                    },
                },

                save: {
                    focus: function () {
                        var
                            $activeElement = $(document.activeElement),
                            inCurrentModal = $activeElement.closest($module).length > 0
                        ;
                        if (!inCurrentModal) {
                            $focusedElement = $(document.activeElement).trigger('blur');
                        }
                    },
                    bodyMargin: function () {
                        initialBodyMargin = $context.css((isBody ? 'margin-' : 'padding-') + (module.can.leftBodyScrollbar() ? 'left' : 'right'));
                        var
                            bodyMarginRightPixel = parseInt(initialBodyMargin.replace(/[^\d.]/g, ''), 10),
                            bodyScrollbarWidth = isBody ? window.innerWidth - document.documentElement.clientWidth : $context[0].offsetWidth - $context[0].clientWidth
                        ;
                        tempBodyMargin = bodyMarginRightPixel + bodyScrollbarWidth;
                    },
                },

                restore: {
                    focus: function () {
                        if ($focusedElement && $focusedElement.length > 0 && settings.restoreFocus) {
                            $focusedElement.trigger('focus');
                        }
                    },
                    bodyMargin: function () {
                        var position = module.can.leftBodyScrollbar() ? 'left' : 'right';
                        $context.css((isBody ? 'margin-' : 'padding-') + position, initialBodyMargin);
                        $context.find(selector.bodyFixed.replace('right', position)).each(function () {
                            var
                                el = $(this),
                                attribute = el.css('position') === 'fixed' ? 'padding-' + position : position
                            ;
                            el.css(attribute, '');
                        });
                    },
                },

                remove: {
                    active: function () {
                        $module.removeClass(className.active);
                    },
                    legacy: function () {
                        $module.removeClass(className.legacy);
                    },
                    clickaway: function () {
                        if (!settings.detachable) {
                            $module
                                .off('mousedown' + elementEventNamespace)
                            ;
                        }
                        $dimmer
                            .off('mousedown' + elementEventNamespace)
                        ;
                        $dimmer
                            .off('mouseup' + elementEventNamespace)
                        ;
                    },
                    dimmerStyles: function () {
                        $dimmer.removeClass(className.inverted);
                        $dimmable.removeClass(className.blurring);
                    },
                    bodyStyle: function () {
                        if ($context.attr('style') === '') {
                            module.verbose('Removing style attribute');
                            $context.removeAttr('style');
                        }
                    },
                    screenHeight: function () {
                        module.debug('Removing page height');
                        $context
                            .css('height', '')
                        ;
                        module.remove.bodyStyle();
                    },
                    keyboardShortcuts: function () {
                        module.verbose('Removing keyboard shortcuts');
                        $document
                            .off('keydown' + eventNamespace)
                        ;
                    },
                    scrolling: function () {
                        if (!keepScrollingClass) {
                            $dimmable.removeClass(className.scrolling);
                        }
                        $module.removeClass(className.scrolling);
                    },
                },

                cacheSizes: function () {
                    $module.addClass(className.loading);
                    var
                        scrollHeight = $module.prop('scrollHeight'),
                        modalWidth   = $module.outerWidth(),
                        modalHeight  = $module.outerHeight()
                    ;
                    if (module.cache.pageHeight === undefined || modalHeight !== 0) {
                        $.extend(module.cache, {
                            pageHeight: $document.outerHeight(),
                            width: modalWidth,
                            height: modalHeight + settings.offset,
                            scrollHeight: scrollHeight + settings.offset,
                            contextHeight: isBody
                                ? $window.height()
                                : $dimmable.height(),
                        });
                        module.cache.topOffset = -(module.cache.height / 2);
                    }
                    $module.removeClass(className.loading);
                    module.debug('Caching modal and container sizes', module.cache);
                },
                helpers: {
                    deQuote: function (string) {
                        return String(string).replace(/"/g, '');
                    },
                    escape: function (string, preserveHTML) {
                        if (preserveHTML) {
                            return string;
                        }
                        var
                            badChars     = /["'<>`]/g,
                            shouldEscape = /["&'<>`]/,
                            escape       = {
                                '<': '&lt;',
                                '>': '&gt;',
                                '"': '&quot;',
                                "'": '&#x27;',
                                '`': '&#x60;',
                            },
                            escapedChar  = function (chr) {
                                return escape[chr];
                            }
                        ;
                        if (shouldEscape.test(string)) {
                            string = string.replace(/&(?![\d#a-z]{1,12};)/gi, '&amp;');

                            return string.replace(badChars, escapedChar);
                        }

                        return string;
                    },
                },
                can: {
                    leftBodyScrollbar: function () {
                        if (module.cache.leftBodyScrollbar === undefined) {
                            module.cache.leftBodyScrollbar = module.is.rtl() && ((module.is.iframe && !module.is.firefox()) || module.is.safari() || module.is.edge() || module.is.ie());
                        }

                        return module.cache.leftBodyScrollbar;
                    },
                    useFlex: function () {
                        if (settings.useFlex === 'auto') {
                            return settings.detachable && !module.is.ie();
                        }
                        if (settings.useFlex && module.is.ie()) {
                            module.debug('useFlex true is not supported in IE');
                        } else if (settings.useFlex && !settings.detachable) {
                            module.debug('useFlex true in combination with detachable false is not supported');
                        }

                        return settings.useFlex;
                    },
                    fit: function () {
                        var
                            contextHeight  = module.cache.contextHeight,
                            verticalCenter = module.cache.contextHeight / 2,
                            topOffset      = module.cache.topOffset,
                            scrollHeight   = module.cache.scrollHeight,
                            height         = module.cache.height,
                            paddingHeight  = settings.padding,
                            startPosition  = verticalCenter + topOffset
                        ;

                        return scrollHeight > height
                            ? startPosition + scrollHeight + paddingHeight < contextHeight
                            : height + (paddingHeight * 2) < contextHeight;
                    },
                },
                has: {
                    configActions: function () {
                        return Array.isArray(settings.actions) && settings.actions.length > 0;
                    },
                    scrollbar: function () {
                        return isBody || $context.css('overflow-y') !== 'hidden';
                    },
                },
                is: {
                    active: function () {
                        return $module.hasClass(className.active);
                    },
                    ie: function () {
                        if (module.cache.isIE === undefined) {
                            var
                                isIE11 = !window.ActiveXObject && 'ActiveXObject' in window,
                                isIE = 'ActiveXObject' in window
                            ;
                            module.cache.isIE = isIE11 || isIE;
                        }

                        return module.cache.isIE;
                    },
                    animating: function () {
                        return $module.transition('is animating');
                    },
                    scrolling: function () {
                        return $dimmable.hasClass(className.scrolling);
                    },
                    modernBrowser: function () {
                        // appName for IE11 reports 'Netscape' can no longer use
                        return !(window.ActiveXObject || 'ActiveXObject' in window);
                    },
                    rtl: function () {
                        if (module.cache.isRTL === undefined) {
                            module.cache.isRTL = $module.attr('dir') === 'rtl' || $module.css('direction') === 'rtl' || $body.attr('dir') === 'rtl' || $body.css('direction') === 'rtl' || $context.attr('dir') === 'rtl' || $context.css('direction') === 'rtl';
                        }

                        return module.cache.isRTL;
                    },
                    safari: function () {
                        if (module.cache.isSafari === undefined) {
                            module.cache.isSafari = /constructor/i.test(window.HTMLElement) || !!window.ApplePaySession;
                        }

                        return module.cache.isSafari;
                    },
                    edge: function () {
                        if (module.cache.isEdge === undefined) {
                            module.cache.isEdge = !!window.setImmediate && !module.is.ie();
                        }

                        return module.cache.isEdge;
                    },
                    firefox: function () {
                        if (module.cache.isFirefox === undefined) {
                            module.cache.isFirefox = !!window.InstallTrigger;
                        }

                        return module.cache.isFirefox;
                    },
                    iframe: function () {
                        return !(self === top);
                    },
                },

                set: {
                    observeAttributes: function (state) {
                        observeAttributes = state !== false;
                    },
                    autofocus: function () {
                        var
                            $autofocus = $inputs.filter('[autofocus]'),
                            $rawInputs = $inputs.filter(':input'),
                            $input     = ($autofocus.length > 0
                                ? $autofocus
                                : ($rawInputs.length > 0
                                    ? $rawInputs
                                    : $module)
                            ).first()
                        ;
                        $input.trigger('focus');
                    },
                    bodyMargin: function () {
                        var position = module.can.leftBodyScrollbar() ? 'left' : 'right';
                        if (settings.detachable || module.can.fit()) {
                            $context.css((isBody ? 'margin-' : 'padding-') + position, tempBodyMargin + 'px');
                        }
                        $context.find(selector.bodyFixed.replace('right', position)).each(function () {
                            var
                                el = $(this),
                                attribute = el.css('position') === 'fixed' ? 'padding-' + position : position
                            ;
                            el.css(attribute, 'calc(' + el.css(attribute) + ' + ' + tempBodyMargin + 'px)');
                        });
                    },
                    clickaway: function () {
                        if (!settings.detachable) {
                            $module
                                .on('mousedown' + elementEventNamespace, module.event.mousedown)
                            ;
                        }
                        $dimmer
                            .on('mousedown' + elementEventNamespace, module.event.mousedown)
                        ;
                        $dimmer
                            .on('mouseup' + elementEventNamespace, module.event.mouseup)
                        ;
                    },
                    dimmerSettings: function () {
                        if ($.fn.dimmer === undefined) {
                            module.error(error.dimmer);

                            return;
                        }
                        var
                            defaultSettings = {
                                debug: settings.debug,
                                dimmerName: 'modals',
                                closable: 'auto',
                                useFlex: module.can.useFlex(),
                                duration: {
                                    show: settings.transition.showDuration || settings.duration,
                                    hide: settings.transition.hideDuration || settings.duration,
                                },
                            },
                            dimmerSettings = $.extend(true, defaultSettings, settings.dimmerSettings)
                        ;
                        if (settings.inverted) {
                            dimmerSettings.variation = dimmerSettings.variation !== undefined
                                ? dimmerSettings.variation + ' inverted'
                                : 'inverted';
                        }
                        $context.dimmer('setting', dimmerSettings);
                    },
                    dimmerStyles: function () {
                        if (settings.inverted) {
                            $dimmer.addClass(className.inverted);
                        } else {
                            $dimmer.removeClass(className.inverted);
                        }
                        if (settings.blurring) {
                            $dimmable.addClass(className.blurring);
                        } else {
                            $dimmable.removeClass(className.blurring);
                        }
                    },
                    modalOffset: function () {
                        if (!settings.detachable) {
                            var canFit = module.can.fit();
                            $module
                                .css({
                                    top: !$module.hasClass('aligned') && canFit
                                        ? $document.scrollTop() + (module.cache.contextHeight - module.cache.height) / 2
                                        : (!canFit || $module.hasClass('top')
                                            ? $document.scrollTop() + settings.padding
                                            : $document.scrollTop() + (module.cache.contextHeight - module.cache.height - settings.padding)),
                                    marginLeft: -(module.cache.width / 2),
                                })
                            ;
                        } else {
                            $module
                                .css({
                                    marginTop: !$module.hasClass('aligned') && module.can.fit()
                                        ? -(module.cache.height / 2)
                                        : settings.padding / 2,
                                    marginLeft: -(module.cache.width / 2),
                                })
                            ;
                        }
                        module.verbose('Setting modal offset for legacy mode');
                    },
                    screenHeight: function () {
                        if (module.can.fit()) {
                            $context.css('height', '');
                        } else if (!$module.hasClass('bottom')) {
                            module.debug('Modal is taller than page content, resizing page height');
                            $context
                                .css('height', module.cache.height + (settings.padding * 2) + 'px')
                            ;
                        }
                    },
                    active: function () {
                        $module.addClass(className.active + ' ' + className.front);
                        $otherModals.filter('.' + className.active).removeClass(className.front);
                    },
                    scrolling: function () {
                        $dimmable.addClass(className.scrolling);
                        $module.addClass(className.scrolling);
                        module.unbind.scrollLock();
                    },
                    legacy: function () {
                        $module.addClass(className.legacy);
                    },
                    type: function () {
                        if (module.can.fit()) {
                            module.verbose('Modal fits on screen');
                            if (!module.others.active() && !module.others.animating()) {
                                module.remove.scrolling();
                                module.bind.scrollLock();
                            }
                        } else if (!$module.hasClass('bottom')) {
                            module.verbose('Modal cannot fit on screen setting to scrolling');
                            module.set.scrolling();
                        } else {
                            module.verbose('Bottom aligned modal not fitting on screen is unsupported for scrolling');
                        }
                    },
                    undetached: function () {
                        $dimmable.addClass(className.undetached);
                    },
                },

                setting: function (name, value) {
                    module.debug('Changing setting', name, value);
                    if ($.isPlainObject(name)) {
                        $.extend(true, settings, name);
                    } else if (value !== undefined) {
                        if ($.isPlainObject(settings[name])) {
                            $.extend(true, settings[name], value);
                        } else {
                            settings[name] = value;
                        }
                    } else {
                        return settings[name];
                    }
                },
                internal: function (name, value) {
                    if ($.isPlainObject(name)) {
                        $.extend(true, module, name);
                    } else if (value !== undefined) {
                        module[name] = value;
                    } else {
                        return module[name];
                    }
                },
                debug: function () {
                    if (!settings.silent && settings.debug) {
                        if (settings.performance) {
                            module.performance.log(arguments);
                        } else {
                            module.debug = Function.prototype.bind.call(console.info, console, settings.name + ':');
                            module.debug.apply(console, arguments);
                        }
                    }
                },
                verbose: function () {
                    if (!settings.silent && settings.verbose && settings.debug) {
                        if (settings.performance) {
                            module.performance.log(arguments);
                        } else {
                            module.verbose = Function.prototype.bind.call(console.info, console, settings.name + ':');
                            module.verbose.apply(console, arguments);
                        }
                    }
                },
                error: function () {
                    if (!settings.silent) {
                        module.error = Function.prototype.bind.call(console.error, console, settings.name + ':');
                        module.error.apply(console, arguments);
                    }
                },
                performance: {
                    log: function (message) {
                        var
                            currentTime,
                            executionTime,
                            previousTime
                        ;
                        if (settings.performance) {
                            currentTime = Date.now();
                            previousTime = time || currentTime;
                            executionTime = currentTime - previousTime;
                            time = currentTime;
                            performance.push({
                                Name: message[0],
                                Arguments: [].slice.call(message, 1) || '',
                                Element: element,
                                'Execution Time': executionTime,
                            });
                        }
                        clearTimeout(module.performance.timer);
                        module.performance.timer = setTimeout(function () {
                            module.performance.display();
                        }, 500);
                    },
                    display: function () {
                        var
                            title = settings.name + ':',
                            totalTime = 0
                        ;
                        time = false;
                        clearTimeout(module.performance.timer);
                        $.each(performance, function (index, data) {
                            totalTime += data['Execution Time'];
                        });
                        title += ' ' + totalTime + 'ms';
                        if (performance.length > 0) {
                            console.groupCollapsed(title);
                            if (console.table) {
                                console.table(performance);
                            } else {
                                $.each(performance, function (index, data) {
                                    console.log(data.Name + ': ' + data['Execution Time'] + 'ms');
                                });
                            }
                            console.groupEnd();
                        }
                        performance = [];
                    },
                },
                invoke: function (query, passedArguments, context) {
                    var
                        object = instance,
                        maxDepth,
                        found,
                        response
                    ;
                    passedArguments = passedArguments || queryArguments;
                    context = context || element;
                    if (typeof query === 'string' && object !== undefined) {
                        query = query.split(/[ .]/);
                        maxDepth = query.length - 1;
                        $.each(query, function (depth, value) {
                            var camelCaseValue = depth !== maxDepth
                                ? value + query[depth + 1].charAt(0).toUpperCase() + query[depth + 1].slice(1)
                                : query;
                            if ($.isPlainObject(object[camelCaseValue]) && (depth !== maxDepth)) {
                                object = object[camelCaseValue];
                            } else if (object[camelCaseValue] !== undefined) {
                                found = object[camelCaseValue];

                                return false;
                            } else if ($.isPlainObject(object[value]) && (depth !== maxDepth)) {
                                object = object[value];
                            } else if (object[value] !== undefined) {
                                found = object[value];

                                return false;
                            } else {
                                module.error(error.method, query);

                                return false;
                            }
                        });
                    }
                    if (isFunction(found)) {
                        response = found.apply(context, passedArguments);
                    } else if (found !== undefined) {
                        response = found;
                    }
                    if (Array.isArray(returnedValue)) {
                        returnedValue.push(response);
                    } else if (returnedValue !== undefined) {
                        returnedValue = [returnedValue, response];
                    } else if (response !== undefined) {
                        returnedValue = response;
                    }

                    return found;
                },
            };

            if (methodInvoked) {
                if (instance === undefined) {
                    if (isFunction(settings.templates[query])) {
                        settings.autoShow = true;
                        settings.className.modal = settings.className.template;
                        settings = $.extend(true, {}, settings, settings.templates[query].apply(module, queryArguments));

                        // reassign shortcuts
                        className = settings.className;
                        namespace = settings.namespace;
                        fields = settings.fields;
                        error = settings.error;
                    }
                    module.initialize();
                }
                if (!isFunction(settings.templates[query])) {
                    module.invoke(query);
                }
            } else {
                if (instance !== undefined) {
                    instance.invoke('destroy');
                }
                module.initialize();
                returnedValue = $module;
            }
        });

        return returnedValue !== undefined
            ? returnedValue
            : this;
    };
    $.modal = $.fn.modal;

    $.fn.modal.settings = {

        name: 'Modal',
        namespace: 'modal',

        useFlex: 'auto',
        offset: 0,

        silent: false,
        debug: false,
        verbose: false,
        performance: true,

        observeChanges: false,

        allowMultiple: false,
        detachable: true,
        closable: true,
        autofocus: true,
        restoreFocus: true,
        autoShow: false,

        inverted: false,
        blurring: false,

        centered: true,

        dimmerSettings: {
            closable: false,
            useCSS: true,
        },

        // whether to use keyboard shortcuts
        keyboardShortcuts: true,

        context: 'body',

        queue: false,
        duration: 500,
        transition: 'scale',

        // padding with edge of page
        padding: 50,
        scrollbarWidth: 10,

        // dynamic content
        title: '',
        content: '',
        class: '',
        classTitle: '',
        classContent: '',
        classActions: '',
        closeIcon: false,
        actions: false,
        preserveHTML: true,

        fields: {
            class: 'class',
            text: 'text',
            icon: 'icon',
            click: 'click',
        },

        // called before show animation
        onShow: function () {},

        // called after show animation
        onVisible: function () {},

        // called before hide animation
        onHide: function () {
            return true;
        },

        // called after hide animation
        onHidden: false,

        // called after approve selector match
        onApprove: function () {
            return true;
        },

        // called after deny selector match
        onDeny: function () {
            return true;
        },

        keys: {
            space: 32,
            enter: 13,
            escape: 27,
            tab: 9,
        },

        selector: {
            title: '> .header',
            content: '> .content',
            actions: '> .actions',
            close: '> .close',
            closeIcon: '> .close',
            approve: '.actions .positive, .actions .approve, .actions .ok',
            deny: '.actions .negative, .actions .deny, .actions .cancel',
            modal: '.ui.modal',
            dimmer: '> .ui.dimmer',
            bodyFixed: '> .ui.fixed.menu, > .ui.right.toast-container, > .ui.right.sidebar, > .ui.fixed.nag, > .ui.fixed.nag > .close',
            prompt: '.ui.input > input',
        },
        error: {
            dimmer: 'UI Dimmer, a required component is not included in this page',
            method: 'The method you called is not defined.',
            notFound: 'The element you specified could not be found',
        },
        className: {
            active: 'active',
            animating: 'animating',
            blurring: 'blurring',
            inverted: 'inverted',
            legacy: 'legacy',
            loading: 'loading',
            scrolling: 'scrolling',
            undetached: 'undetached',
            front: 'front',
            close: 'close icon',
            button: 'ui button',
            modal: 'ui modal',
            title: 'header',
            content: 'content',
            actions: 'actions',
            template: 'ui tiny modal',
            ok: 'positive',
            cancel: 'negative',
            prompt: 'ui fluid input',
            innerDimmer: 'ui inverted dimmer',
        },
        text: {
            ok: 'Ok',
            cancel: 'Cancel',
            close: 'Close',
        },
    };

    $.fn.modal.settings.templates = {
        getArguments: function (args) {
            var queryArguments = [].slice.call(args);
            if ($.isPlainObject(queryArguments[0])) {
                return $.extend({
                    handler: function () {},
                    content: '',
                    title: '',
                }, queryArguments[0]);
            }
            if (!isFunction(queryArguments[queryArguments.length - 1])) {
                queryArguments.push(function () {});
            }

            return {
                handler: queryArguments.pop(),
                content: queryArguments.pop() || '',
                title: queryArguments.pop() || '',
            };
        },
        alert: function () {
            var
                settings = this.get.settings(),
                args     = settings.templates.getArguments(arguments),
                approveFn = args.handler
            ;

            return {
                title: args.title,
                content: args.content,
                onApprove: approveFn,
                actions: [{
                    text: settings.text.ok,
                    class: settings.className.ok,
                    click: approveFn,
                }],
            };
        },
        confirm: function () {
            var
                settings = this.get.settings(),
                args     = settings.templates.getArguments(arguments),
                approveFn = function () {
                    args.handler(true);
                },
                denyFn = function () {
                    args.handler(false);
                }
            ;

            return {
                title: args.title,
                content: args.content,
                onApprove: approveFn,
                onDeny: denyFn,
                actions: [{
                    text: settings.text.ok,
                    class: settings.className.ok,
                    click: approveFn,
                }, {
                    text: settings.text.cancel,
                    class: settings.className.cancel,
                    click: denyFn,
                }],
            };
        },
        prompt: function () {
            var
                $this    = this,
                settings = this.get.settings(),
                args     = settings.templates.getArguments(arguments),
                input    = $($.parseHTML(args.content)).filter('.ui.input'),
                approveFn = function () {
                    var
                        settings = $this.get.settings(),
                        inputField = $this.get.element().find(settings.selector.prompt)[0]
                    ;
                    args.handler($(inputField).val());
                },
                denyFn = function () {
                    args.handler(null);
                }
            ;
            if (input.length === 0) {
                args.content += '<p><div class="' + this.helpers.deQuote(settings.className.prompt) + '"><input placeholder="' + this.helpers.deQuote(args.placeholder || '') + '" type="text" value="' + this.helpers.deQuote(args.defaultValue || '') + '"></div></p>';
            }

            return {
                title: args.title,
                content: args.content,
                onApprove: approveFn,
                onDeny: denyFn,
                actions: [{
                    text: settings.text.ok,
                    class: settings.className.ok,
                    click: approveFn,
                }, {
                    text: settings.text.cancel,
                    class: settings.className.cancel,
                    click: denyFn,
                }],
            };
        },
    };
})(jQuery, window, document);

/*!
 * # Fomantic-UI 2.9.4 - Search
 * https://github.com/fomantic/Fomantic-UI/
 *
 *
 * Released under the MIT license
 * https://opensource.org/licenses/MIT
 *
 */

(function ($, window, document) {
    'use strict';

    function isFunction(obj) {
        return typeof obj === 'function' && typeof obj.nodeType !== 'number';
    }

    window = window !== undefined && window.Math === Math
        ? window
        : globalThis;

    $.fn.search = function (parameters) {
        var
            $allModules     = $(this),

            time            = Date.now(),
            performance     = [],

            query           = arguments[0],
            methodInvoked   = typeof query === 'string',
            queryArguments  = [].slice.call(arguments, 1),
            returnedValue
        ;
        $allModules.each(function () {
            var
                settings          = $.isPlainObject(parameters)
                    ? $.extend(true, {}, $.fn.search.settings, parameters)
                    : $.extend({}, $.fn.search.settings),

                className        = settings.className,
                metadata         = settings.metadata,
                regExp           = settings.regExp,
                fields           = settings.fields,
                selector         = settings.selector,
                error            = settings.error,
                namespace        = settings.namespace,

                eventNamespace   = '.' + namespace,
                moduleNamespace  = namespace + '-module',

                $module          = $(this),
                $prompt          = $module.find(selector.prompt),
                $searchButton    = $module.find(selector.searchButton),
                $results         = $module.find(selector.results),
                $result          = $module.find(selector.result),
                $category        = $module.find(selector.category),

                element          = this,
                instance         = $module.data(moduleNamespace),

                disabledBubbled  = false,
                resultsDismissed = false,

                module
            ;

            module = {

                initialize: function () {
                    module.verbose('Initializing module');
                    module.get.settings();
                    module.determine.searchFields();
                    module.bind.events();
                    module.set.type();
                    module.create.results();
                    module.instantiate();
                },
                instantiate: function () {
                    module.verbose('Storing instance of module', module);
                    instance = module;
                    $module
                        .data(moduleNamespace, module)
                    ;
                },
                destroy: function () {
                    module.verbose('Destroying instance');
                    $module
                        .off(eventNamespace)
                        .removeData(moduleNamespace)
                    ;
                },

                refresh: function () {
                    module.debug('Refreshing selector cache');
                    $prompt = $module.find(selector.prompt);
                    $searchButton = $module.find(selector.searchButton);
                    $category = $module.find(selector.category);
                    $results = $module.find(selector.results);
                    $result = $module.find(selector.result);
                },

                refreshResults: function () {
                    $results = $module.find(selector.results);
                    $result = $module.find(selector.result);
                },

                bind: {
                    events: function () {
                        module.verbose('Binding events to search');
                        if (settings.automatic) {
                            $module
                                .on(module.get.inputEvent() + eventNamespace, selector.prompt, module.event.input)
                            ;
                            $prompt
                                .attr('autocomplete', module.is.chrome() ? 'fomantic-search' : 'off')
                            ;
                        }
                        $module
                            // prompt
                            .on('focus' + eventNamespace, selector.prompt, module.event.focus)
                            .on('blur' + eventNamespace, selector.prompt, module.event.blur)
                            .on('keydown' + eventNamespace, selector.prompt, module.handleKeyboard)
                            // search button
                            .on('click' + eventNamespace, selector.searchButton, module.query)
                            // results
                            .on('mousedown' + eventNamespace, selector.results, module.event.result.mousedown)
                            .on('mouseup' + eventNamespace, selector.results, module.event.result.mouseup)
                            .on('click' + eventNamespace, selector.result, module.event.result.click)
                            .on('click' + eventNamespace, selector.remove, module.event.remove.click)
                        ;
                    },
                },

                determine: {
                    searchFields: function () {
                        // this makes sure $.extend does not add specified search fields to default fields
                        // this is the only setting which should not extend defaults
                        if (parameters && parameters.searchFields !== undefined) {
                            settings.searchFields = Array.isArray(parameters.searchFields)
                                ? parameters.searchFields
                                : [parameters.searchFields]
                            ;
                        }
                    },
                },

                event: {
                    input: function () {
                        if (settings.searchDelay) {
                            clearTimeout(module.timer);
                            module.timer = setTimeout(function () {
                                if (module.is.focused()) {
                                    module.query();
                                }
                            }, settings.searchDelay);
                        } else {
                            module.query();
                        }
                    },
                    focus: function () {
                        module.set.focus();
                        if (settings.searchOnFocus && module.has.minimumCharacters()) {
                            module.query(function () {
                                if (module.can.show()) {
                                    module.showResults();
                                }
                            });
                        }
                    },
                    blur: function (event) {
                        var
                            pageLostFocus = document.activeElement === this,
                            callback      = function () {
                                module.cancel.query();
                                module.remove.focus();
                                module.timer = setTimeout(function () {
                                    module.hideResults();
                                }, settings.hideDelay);
                            }
                        ;
                        if (pageLostFocus) {
                            return;
                        }
                        resultsDismissed = false;
                        if (module.resultsClicked) {
                            module.debug('Determining if user action caused search to close');
                            $module
                                .one('click.close' + eventNamespace, selector.results, function (event) {
                                    if (module.is.inMessage(event) || disabledBubbled) {
                                        $prompt.trigger('focus');

                                        return;
                                    }
                                    disabledBubbled = false;
                                    if (!module.is.animating() && !module.is.hidden()) {
                                        callback();
                                    }
                                })
                            ;
                        } else {
                            module.debug('Input blurred without user action, closing results');
                            callback();
                        }
                    },
                    remove: {
                        click: function () {
                            module.clear.value();
                            $prompt.trigger('focus');
                        },
                    },
                    result: {
                        mousedown: function () {
                            module.resultsClicked = true;
                        },
                        mouseup: function () {
                            module.resultsClicked = false;
                        },
                        click: function (event) {
                            module.debug('Search result selected');
                            var
                                $result = $(this),
                                $title  = $result.find(selector.title).eq(0),
                                $link   = $result.is('a[href]')
                                    ? $result
                                    : $result.find('a[href]').eq(0),
                                href    = $link.attr('href') || false,
                                target  = $link.attr('target') || false,
                                // title is used for result lookup
                                value   = $title.length > 0
                                    ? $title.text()
                                    : false,
                                results = module.get.results(),
                                result  = $result.data(metadata.result) || module.get.result(value, results)
                            ;
                            var oldValue = module.get.value();
                            if (isFunction(settings.onSelect)) {
                                if (settings.onSelect.call(element, result, results) === false) {
                                    module.debug('Custom onSelect callback cancelled default select action');
                                    disabledBubbled = true;

                                    return;
                                }
                            }
                            module.hideResults();
                            if (value && module.get.value() === oldValue) {
                                module.set.value(value);
                            }
                            if (href) {
                                event.preventDefault();
                                module.verbose('Opening search link found in result', $link);
                                if (target === '_blank' || event.ctrlKey) {
                                    window.open(href);
                                } else {
                                    window.location.href = href;
                                }
                            }
                        },
                    },
                },
                ensureVisible: function ($el) {
                    var
                        elTop,
                        elBottom,
                        resultsScrollTop,
                        resultsHeight
                    ;
                    if ($el.length === 0) {
                        return;
                    }
                    elTop = $el.position().top;
                    elBottom = elTop + $el.outerHeight(true);

                    resultsScrollTop = $results.scrollTop();
                    resultsHeight = $results.height();

                    if (elTop < 0) {
                        $results.scrollTop(resultsScrollTop + elTop);
                    } else if (resultsHeight < elBottom) {
                        $results.scrollTop(resultsScrollTop + (elBottom - resultsHeight));
                    }
                },
                handleKeyboard: function (event) {
                    var
                        // force selector refresh
                        $result         = $module.find(selector.result),
                        $category       = $module.find(selector.category),
                        $activeResult   = $result.filter('.' + className.active),
                        currentIndex    = $result.index($activeResult),
                        resultSize      = $result.length,
                        hasActiveResult = $activeResult.length > 0,

                        keyCode         = event.which,
                        keys            = {
                            backspace: 8,
                            enter: 13,
                            escape: 27,
                            upArrow: 38,
                            downArrow: 40,
                        },
                        newIndex
                    ;
                    // search shortcuts
                    if (keyCode === keys.escape) {
                        if (!module.is.visible()) {
                            module.verbose('Escape key pressed, blurring search field');
                            $prompt.trigger('blur');
                        } else {
                            module.hideResults();
                        }
                        event.stopPropagation();
                        resultsDismissed = true;
                    }
                    if (module.is.visible()) {
                        if (keyCode === keys.enter) {
                            module.verbose('Enter key pressed, selecting active result');
                            if ($result.filter('.' + className.active).length > 0) {
                                module.event.result.click.call($result.filter('.' + className.active), event);
                                event.preventDefault();

                                return false;
                            }
                        } else if (keyCode === keys.upArrow && hasActiveResult) {
                            module.verbose('Up key pressed, changing active result');
                            newIndex = currentIndex - 1 < 0
                                ? currentIndex
                                : currentIndex - 1;
                            $category
                                .removeClass(className.active)
                            ;
                            $result
                                .removeClass(className.active)
                                .eq(newIndex)
                                .addClass(className.active)
                                .closest($category)
                                .addClass(className.active)
                            ;
                            module.ensureVisible($result.eq(newIndex));
                            event.preventDefault();
                        } else if (keyCode === keys.downArrow) {
                            module.verbose('Down key pressed, changing active result');
                            newIndex = currentIndex + 1 >= resultSize
                                ? currentIndex
                                : currentIndex + 1;
                            $category
                                .removeClass(className.active)
                            ;
                            $result
                                .removeClass(className.active)
                                .eq(newIndex)
                                .addClass(className.active)
                                .closest($category)
                                .addClass(className.active)
                            ;
                            module.ensureVisible($result.eq(newIndex));
                            event.preventDefault();
                        }
                    } else {
                        // query shortcuts
                        if (keyCode === keys.enter) {
                            module.verbose('Enter key pressed, executing query');
                            module.query();
                            module.set.buttonPressed();
                            $prompt.one('keyup', module.remove.buttonFocus);
                        }
                    }
                },

                setup: {
                    api: function (searchTerm, callback) {
                        var
                            apiSettings = {
                                debug: settings.debug,
                                on: false,
                                cache: settings.cache,
                                action: 'search',
                                urlData: {
                                    query: searchTerm,
                                },
                            },
                            apiCallbacks = {
                                onSuccess: function (response, $module, xhr) {
                                    module.parse.response.call(element, response, searchTerm);
                                    callback();
                                    if (settings.apiSettings && typeof settings.apiSettings.onSuccess === 'function') {
                                        settings.apiSettings.onSuccess.call(this, response, $module, xhr);
                                    }
                                },
                                onFailure: function (response, $module, xhr) {
                                    module.displayMessage(error.serverError);
                                    callback();
                                    if (settings.apiSettings && typeof settings.apiSettings.onFailure === 'function') {
                                        settings.apiSettings.onFailure.call(this, response, $module, xhr);
                                    }
                                },
                                onAbort: function (status, $module, xhr) {
                                    if (settings.apiSettings && typeof settings.apiSettings.onAbort === 'function') {
                                        settings.apiSettings.onAbort.call(this, status, $module, xhr);
                                    }
                                },
                                onError: function (errorMessage, $module, xhr) {
                                    module.error();
                                    if (settings.apiSettings && typeof settings.apiSettings.onError === 'function') {
                                        settings.apiSettings.onError.call(this, errorMessage, $module, xhr);
                                    }
                                },
                            }
                        ;
                        $.extend(true, apiSettings, settings.apiSettings, apiCallbacks);
                        module.verbose('Setting up API request', apiSettings);
                        $module.api(apiSettings);
                    },
                },

                can: {
                    useAPI: function () {
                        return $.fn.api !== undefined;
                    },
                    show: function () {
                        return module.is.focused() && !module.is.visible() && !module.is.empty();
                    },
                    transition: function () {
                        return settings.transition && $.fn.transition !== undefined;
                    },
                },

                is: {
                    animating: function () {
                        return $results.hasClass(className.animating);
                    },
                    chrome: function () {
                        return !!window.chrome && !window.StyleMedia;
                    },
                    hidden: function () {
                        return $results.hasClass(className.hidden);
                    },
                    inMessage: function (event) {
                        if (!event.target) {
                            return;
                        }
                        var
                            $target = $(event.target),
                            isInDOM = $.contains(document.documentElement, event.target)
                        ;

                        return isInDOM && $target.closest(selector.message).length > 0;
                    },
                    empty: function () {
                        return $results.html() === '';
                    },
                    visible: function () {
                        return $results.filter(':visible').length > 0;
                    },
                    focused: function () {
                        return $prompt.filter(':focus').length > 0;
                    },
                },

                get: {
                    settings: function () {
                        if ($.isPlainObject(parameters) && parameters.searchFullText) {
                            settings.fullTextSearch = parameters.searchFullText;
                            module.error(settings.error.oldSearchSyntax, element);
                        }
                        if (settings.ignoreDiacritics && !String.prototype.normalize) {
                            settings.ignoreDiacritics = false;
                            module.error(error.noNormalize, element);
                        }
                    },
                    inputEvent: function () {
                        var
                            prompt = $prompt[0],
                            inputEvent   = prompt !== undefined && prompt.oninput !== undefined
                                ? 'input'
                                : (prompt !== undefined && prompt.onpropertychange !== undefined
                                    ? 'propertychange'
                                    : 'keyup')
                        ;

                        return inputEvent;
                    },
                    value: function () {
                        return $prompt.val();
                    },
                    results: function () {
                        return $module.data(metadata.results);
                    },
                    result: function (value, results) {
                        var
                            result       = false
                        ;
                        value = value !== undefined
                            ? value
                            : module.get.value();
                        results = results !== undefined
                            ? results
                            : module.get.results();
                        if (settings.type === 'category') {
                            module.debug('Finding result that matches', value);
                            $.each(results, function (index, category) {
                                if (Array.isArray(category.results)) {
                                    result = module.search.object(value, category.results)[0];
                                    // don't continue searching if a result is found
                                    if (result) {
                                        return false;
                                    }
                                }
                            });
                        } else {
                            module.debug('Finding result in results object', value);
                            result = module.search.object(value, results)[0];
                        }

                        return result || false;
                    },
                },

                select: {
                    firstResult: function () {
                        module.verbose('Selecting first result');
                        $result.first().addClass(className.active);
                    },
                },

                set: {
                    focus: function () {
                        $module.addClass(className.focus);
                    },
                    loading: function () {
                        $module.addClass(className.loading);
                    },
                    value: function (value) {
                        module.verbose('Setting search input value', value);
                        $prompt
                            .val(value)
                        ;
                    },
                    type: function (type) {
                        type = type || settings.type;
                        if (className[type]) {
                            $module.addClass(className[type]);
                        }
                    },
                    buttonPressed: function () {
                        $searchButton.addClass(className.pressed);
                    },
                },

                remove: {
                    loading: function () {
                        $module.removeClass(className.loading);
                    },
                    focus: function () {
                        $module.removeClass(className.focus);
                    },
                    buttonPressed: function () {
                        $searchButton.removeClass(className.pressed);
                    },
                    diacritics: function (text) {
                        return settings.ignoreDiacritics ? text.normalize('NFD').replace(/[\u0300-\u036F]/g, '') : text;
                    },
                },

                query: function (callback) {
                    callback = isFunction(callback)
                        ? callback
                        : function () {};
                    var
                        searchTerm = module.get.value(),
                        cache = module.read.cache(searchTerm)
                    ;
                    callback = callback || function () {};
                    if (module.has.minimumCharacters()) {
                        if (cache) {
                            module.debug('Reading result from cache', searchTerm);
                            module.save.results(cache.results);
                            settings.onResults.call(element, cache.results, true);
                            module.addResults(cache.html);
                            module.inject.id(cache.results);
                            callback();
                        } else {
                            module.debug('Querying for', searchTerm);
                            if ($.isPlainObject(settings.source) || Array.isArray(settings.source)) {
                                module.search.local(searchTerm);
                                callback();
                            } else if (module.can.useAPI()) {
                                module.search.remote(searchTerm, callback);
                            } else {
                                module.error(error.source);
                                callback();
                            }
                        }
                        settings.onSearchQuery.call(element, searchTerm);
                    } else {
                        module.hideResults();
                    }
                },

                search: {
                    local: function (searchTerm) {
                        var
                            results = module.search.object(searchTerm, settings.source),
                            searchHTML
                        ;
                        module.set.loading();
                        module.save.results(results);
                        module.debug('Returned full local search results', results);
                        if (settings.maxResults > 0) {
                            module.debug('Using specified max results', results);
                            results = results.slice(0, settings.maxResults);
                        }
                        if (settings.type === 'category') {
                            results = module.create.categoryResults(results);
                        }
                        searchHTML = module.generateResults({
                            results: results,
                        });
                        module.remove.loading();
                        module.addResults(searchHTML);
                        module.inject.id(results);
                        module.write.cache(searchTerm, {
                            html: searchHTML,
                            results: results,
                        });
                    },
                    remote: function (searchTerm, callback) {
                        callback = isFunction(callback)
                            ? callback
                            : function () {};
                        if ($module.api('is loading')) {
                            $module.api('abort');
                        }
                        module.setup.api(searchTerm, callback);
                        $module
                            .api('query')
                        ;
                    },
                    object: function (searchTerm, source, searchFields) {
                        searchTerm = module.remove.diacritics(String(searchTerm));
                        var
                            results      = [],
                            exactResults = [],
                            fuzzyResults = [],
                            searchExp    = searchTerm.replace(regExp.escape, '\\$&'),
                            matchRegExp = new RegExp(regExp.beginsWith + searchExp, settings.ignoreSearchCase ? 'i' : ''),

                            // avoid duplicates when pushing results
                            addResult = function (array, result) {
                                var
                                    notResult      = $.inArray(result, results) === -1,
                                    notFuzzyResult = $.inArray(result, fuzzyResults) === -1,
                                    notExactResults = $.inArray(result, exactResults) === -1
                                ;
                                if (notResult && notFuzzyResult && notExactResults) {
                                    array.push(result);
                                }
                            }
                        ;
                        source = source || settings.source;
                        searchFields = searchFields !== undefined
                            ? searchFields
                            : settings.searchFields;

                        // search fields should be array to loop correctly
                        if (!Array.isArray(searchFields)) {
                            searchFields = [searchFields];
                        }

                        // exit conditions if no source
                        if (source === undefined || source === false) {
                            module.error(error.source);

                            return [];
                        }
                        // iterate through search fields looking for matches
                        var lastSearchFieldIndex = searchFields.length - 1;
                        $.each(source, function (label, content) {
                            var concatenatedContent = [];
                            $.each(searchFields, function (index, field) {
                                var
                                    fieldExists = typeof content[field] === 'string' || typeof content[field] === 'number'
                                ;
                                if (fieldExists) {
                                    var text;
                                    text = typeof content[field] === 'string'
                                        ? module.remove.diacritics(content[field])
                                        : content[field].toString();
                                    text = $('<div/>', { html: text }).text().trim();
                                    if (settings.fullTextSearch === 'all') {
                                        concatenatedContent.push(text);
                                        if (index < lastSearchFieldIndex) {
                                            return true;
                                        }
                                        text = concatenatedContent.join(' ');
                                    }
                                    if (settings.fullTextSearch !== 'all' && text.search(matchRegExp) !== -1) {
                                        // content starts with value (first in results)
                                        addResult(results, content);
                                    } else if (settings.fullTextSearch === 'exact' && module.exactSearch(searchTerm, text)) {
                                        addResult(exactResults, content);
                                    } else if (settings.fullTextSearch === 'some' && module.wordSearch(searchTerm, text)) {
                                        addResult(exactResults, content);
                                    } else if (settings.fullTextSearch === 'all' && module.wordSearch(searchTerm, text, true)) {
                                        addResult(exactResults, content);
                                    } else if (settings.fullTextSearch === true && module.fuzzySearch(searchTerm, text)) {
                                        // content fuzzy matches (last in results)
                                        addResult(fuzzyResults, content);
                                    }
                                }
                            });
                        });
                        $.merge(exactResults, fuzzyResults);
                        $.merge(results, exactResults);

                        return results;
                    },
                },
                exactSearch: function (query, term) {
                    if (settings.ignoreSearchCase) {
                        query = query.toLowerCase();
                        term = term.toLowerCase();
                    }

                    return term.indexOf(query) > -1;
                },
                wordSearch: function (query, term, matchAll) {
                    var allWords = query.split(/\s+/),
                        w,
                        wL = allWords.length,
                        found = false
                    ;
                    for (w = 0; w < wL; w++) {
                        found = module.exactSearch(allWords[w], term);
                        if ((!found && matchAll) || (found && !matchAll)) {
                            break;
                        }
                    }

                    return found;
                },
                fuzzySearch: function (query, term) {
                    var
                        termLength  = term.length,
                        queryLength = query.length
                    ;
                    if (typeof query !== 'string') {
                        return false;
                    }
                    if (settings.ignoreSearchCase) {
                        query = query.toLowerCase();
                        term = term.toLowerCase();
                    }
                    if (queryLength > termLength) {
                        return false;
                    }
                    if (queryLength === termLength) {
                        return query === term;
                    }
                    for (var characterIndex = 0, nextCharacterIndex = 0; characterIndex < queryLength; characterIndex++) {
                        var
                            continueSearch = false,
                            queryCharacter = query.charCodeAt(characterIndex)
                        ;
                        while (nextCharacterIndex < termLength) {
                            if (term.charCodeAt(nextCharacterIndex++) === queryCharacter) {
                                continueSearch = true;

                                break;
                            }
                        }

                        if (!continueSearch) {
                            return false;
                        }
                    }

                    return true;
                },

                parse: {
                    response: function (response, searchTerm) {
                        if (Array.isArray(response)) {
                            var o = {};
                            o[fields.results] = response;
                            response = o;
                        }
                        var
                            searchHTML = module.generateResults(response)
                        ;
                        module.verbose('Parsing server response', response);
                        if (response !== undefined) {
                            if (searchTerm !== undefined && response[fields.results] !== undefined) {
                                module.addResults(searchHTML);
                                module.inject.id(response[fields.results]);
                                module.write.cache(searchTerm, {
                                    html: searchHTML,
                                    results: response[fields.results],
                                });
                                module.save.results(response[fields.results]);
                            }
                        }
                    },
                },

                cancel: {
                    query: function () {
                        if (module.can.useAPI()) {
                            $module.api('abort');
                        }
                    },
                },

                has: {
                    minimumCharacters: function () {
                        var
                            searchTerm    = module.get.value(),
                            numCharacters = searchTerm.length
                        ;

                        return numCharacters >= settings.minCharacters;
                    },
                    results: function () {
                        if ($results.length === 0) {
                            return false;
                        }
                        var
                            html = $results.html()
                        ;

                        return html !== '';
                    },
                },

                clear: {
                    cache: function (value) {
                        var
                            cache = $module.data(metadata.cache)
                        ;
                        if (!value) {
                            module.debug('Clearing cache', value);
                            $module.removeData(metadata.cache);
                        } else if (value && cache && cache[value]) {
                            module.debug('Removing value from cache', value);
                            delete cache[value];
                            $module.data(metadata.cache, cache);
                        }
                    },
                    value: function () {
                        module.set.value('');
                    },
                },

                read: {
                    cache: function (name) {
                        var
                            cache = $module.data(metadata.cache)
                        ;
                        if (settings.cache) {
                            module.verbose('Checking cache for generated html for query', name);

                            return (typeof cache === 'object') && (cache[name] !== undefined)
                                ? cache[name]
                                : false;
                        }

                        return false;
                    },
                },

                create: {
                    categoryResults: function (results) {
                        var
                            categoryResults = {}
                        ;
                        $.each(results, function (index, result) {
                            if (!result.category) {
                                return;
                            }
                            if (categoryResults[result.category] === undefined) {
                                module.verbose('Creating new category of results', result.category);
                                categoryResults[result.category] = {
                                    name: result.category,
                                    results: [result],
                                };
                            } else {
                                categoryResults[result.category].results.push(result);
                            }
                        });

                        return categoryResults;
                    },
                    id: function (resultIndex, categoryIndex) {
                        var
                            resultID      = resultIndex + 1, // not zero indexed
                            letterID,
                            id
                        ;
                        if (categoryIndex !== undefined) {
                            // start char code for "A"
                            letterID = String.fromCharCode(97 + categoryIndex);
                            id = letterID + resultID;
                            module.verbose('Creating category result id', id);
                        } else {
                            id = resultID;
                            module.verbose('Creating result id', id);
                        }

                        return id;
                    },
                    results: function () {
                        if ($results.length === 0) {
                            $results = $('<div />')
                                .addClass(className.results)
                                .appendTo($module)
                            ;
                        }
                    },
                },

                inject: {
                    result: function (result, resultIndex, categoryIndex) {
                        module.verbose('Injecting result into results');
                        var
                            $selectedResult = categoryIndex !== undefined
                                ? $results
                                    .children().eq(categoryIndex)
                                    .children(selector.results)
                                    .first()
                                    .children(selector.result)
                                    .eq(resultIndex)
                                : $results
                                    .children(selector.result).eq(resultIndex)
                        ;
                        module.verbose('Injecting results metadata', $selectedResult);
                        $selectedResult
                            .data(metadata.result, result)
                        ;
                    },
                    id: function (results) {
                        module.debug('Injecting unique ids into results');
                        var
                            // since results may be object, we must use counters
                            categoryIndex = 0,
                            resultIndex   = 0
                        ;
                        if (settings.type === 'category') {
                            // iterate through each category result
                            $.each(results, function (index, category) {
                                if (category.results.length > 0) {
                                    resultIndex = 0;
                                    $.each(category.results, function (index, result) {
                                        if (result.id === undefined) {
                                            result.id = module.create.id(resultIndex, categoryIndex);
                                        }
                                        module.inject.result(result, resultIndex, categoryIndex);
                                        resultIndex++;
                                    });
                                    categoryIndex++;
                                }
                            });
                        } else {
                            // top level
                            $.each(results, function (index, result) {
                                if (result.id === undefined) {
                                    result.id = module.create.id(resultIndex);
                                }
                                module.inject.result(result, resultIndex);
                                resultIndex++;
                            });
                        }

                        return results;
                    },
                },

                save: {
                    results: function (results) {
                        module.verbose('Saving current search results to metadata', results);
                        $module.data(metadata.results, results);
                    },
                },

                write: {
                    cache: function (name, value) {
                        var
                            cache = $module.data(metadata.cache) !== undefined
                                ? $module.data(metadata.cache)
                                : {}
                        ;
                        if (settings.cache) {
                            module.verbose('Writing generated html to cache', name, value);
                            cache[name] = value;
                            $module
                                .data(metadata.cache, cache)
                            ;
                        }
                    },
                },

                addResults: function (html) {
                    if (isFunction(settings.onResultsAdd)) {
                        if (settings.onResultsAdd.call($results, html) === false) {
                            module.debug('onResultsAdd callback cancelled default action');

                            return false;
                        }
                    }
                    if (html) {
                        $results
                            .html(html)
                        ;
                        module.refreshResults();
                        if (settings.selectFirstResult) {
                            module.select.firstResult();
                        }
                        module.showResults();
                    } else {
                        module.hideResults(function () {
                            $results.empty();
                        });
                    }
                },

                showResults: function (callback) {
                    callback = isFunction(callback)
                        ? callback
                        : function () {};
                    if (resultsDismissed) {
                        return;
                    }
                    if (!module.is.visible() && module.has.results()) {
                        if (module.can.transition()) {
                            module.debug('Showing results with css animations');
                            $results
                                .transition({
                                    animation: settings.transition + ' in',
                                    debug: settings.debug,
                                    verbose: settings.verbose,
                                    silent: settings.silent,
                                    duration: settings.duration,
                                    onShow: function () {
                                        var $firstResult = $module.find(selector.result).eq(0);
                                        module.ensureVisible($firstResult);
                                    },
                                    onComplete: function () {
                                        callback();
                                    },
                                    queue: true,
                                })
                            ;
                        } else {
                            module.debug('Showing results with javascript');
                            $results
                                .stop()
                                .fadeIn(settings.duration, settings.easing)
                            ;
                        }
                        settings.onResultsOpen.call($results);
                    }
                },
                hideResults: function (callback) {
                    callback = isFunction(callback)
                        ? callback
                        : function () {};
                    if (module.is.visible()) {
                        if (module.can.transition()) {
                            module.debug('Hiding results with css animations');
                            $results
                                .transition({
                                    animation: settings.transition + ' out',
                                    debug: settings.debug,
                                    verbose: settings.verbose,
                                    silent: settings.silent,
                                    duration: settings.duration,
                                    onComplete: function () {
                                        callback();
                                    },
                                    queue: true,
                                })
                            ;
                        } else {
                            module.debug('Hiding results with javascript');
                            $results
                                .stop()
                                .fadeOut(settings.duration, settings.easing)
                            ;
                        }
                        settings.onResultsClose.call($results);
                    }
                },

                generateResults: function (response) {
                    module.debug('Generating html from response', response);
                    var
                        template       = settings.templates[settings.type],
                        isProperObject = $.isPlainObject(response[fields.results]) && !$.isEmptyObject(response[fields.results]),
                        isProperArray  = Array.isArray(response[fields.results]) && response[fields.results].length > 0,
                        html           = ''
                    ;
                    if (isProperObject || isProperArray) {
                        if (settings.maxResults > 0) {
                            if (isProperObject) {
                                if (settings.type === 'standard') {
                                    module.error(error.maxResults);
                                }
                            } else {
                                response[fields.results] = response[fields.results].slice(0, settings.maxResults);
                            }
                        }
                        if (settings.highlightMatches) {
                            var results = response[fields.results],
                                regExpIgnore = settings.ignoreSearchCase ? 'i' : '',
                                querySplit = module.get.value().split(''),
                                diacriticReg = settings.ignoreDiacritics ? '[\u0300-\u036F]?' : '',
                                htmlReg = '(?![^<]*>)',
                                markedRegExp = new RegExp(htmlReg + '(' + querySplit.join(diacriticReg + ')(.*?)' + htmlReg + '(') + diacriticReg + ')', regExpIgnore),
                                markedReplacer = function () {
                                    var args = [].slice.call(arguments, 1, querySplit.length * 2).map(function (x, i) {
                                        return i & 1 ? x : '<mark>' + x + '</mark>'; // eslint-disable-line no-bitwise
                                    });

                                    return args.join('');
                                }
                            ;
                            $.each(results, function (label, content) {
                                $.each(settings.searchFields, function (index, field) {
                                    var
                                        fieldExists = typeof content[field] === 'string' || typeof content[field] === 'number'
                                    ;
                                    if (fieldExists) {
                                        var markedHTML = typeof content[field] === 'string'
                                            ? content[field]
                                            : content[field].toString();
                                        if (settings.ignoreDiacritics) {
                                            markedHTML = markedHTML.normalize('NFD');
                                        }
                                        markedHTML = markedHTML.replace(/<\/?mark>/g, '');
                                        response[fields.results][label][field] = markedHTML.replace(markedRegExp, markedReplacer);
                                    }
                                });
                            });
                        }
                        if (isFunction(template)) {
                            html = template(response, fields, settings.preserveHTML);
                        } else {
                            module.error(error.noTemplate, false);
                        }
                    } else if (settings.showNoResults) {
                        html = module.displayMessage(error.noResults, 'empty', error.noResultsHeader);
                    }
                    settings.onResults.call(element, response);

                    return html;
                },

                displayMessage: function (text, type, header) {
                    type = type || 'standard';
                    module.debug('Displaying message', text, type, header);
                    module.addResults(settings.templates.message(text, type, header));

                    return settings.templates.message(text, type, header);
                },

                setting: function (name, value) {
                    if ($.isPlainObject(name)) {
                        $.extend(true, settings, name);
                    } else if (value !== undefined) {
                        settings[name] = value;
                    } else {
                        return settings[name];
                    }
                },
                internal: function (name, value) {
                    if ($.isPlainObject(name)) {
                        $.extend(true, module, name);
                    } else if (value !== undefined) {
                        module[name] = value;
                    } else {
                        return module[name];
                    }
                },
                debug: function () {
                    if (!settings.silent && settings.debug) {
                        if (settings.performance) {
                            module.performance.log(arguments);
                        } else {
                            module.debug = Function.prototype.bind.call(console.info, console, settings.name + ':');
                            module.debug.apply(console, arguments);
                        }
                    }
                },
                verbose: function () {
                    if (!settings.silent && settings.verbose && settings.debug) {
                        if (settings.performance) {
                            module.performance.log(arguments);
                        } else {
                            module.verbose = Function.prototype.bind.call(console.info, console, settings.name + ':');
                            module.verbose.apply(console, arguments);
                        }
                    }
                },
                error: function () {
                    if (!settings.silent) {
                        module.error = Function.prototype.bind.call(console.error, console, settings.name + ':');
                        module.error.apply(console, arguments);
                    }
                },
                performance: {
                    log: function (message) {
                        var
                            currentTime,
                            executionTime,
                            previousTime
                        ;
                        if (settings.performance) {
                            currentTime = Date.now();
                            previousTime = time || currentTime;
                            executionTime = currentTime - previousTime;
                            time = currentTime;
                            performance.push({
                                Name: message[0],
                                Arguments: [].slice.call(message, 1) || '',
                                Element: element,
                                'Execution Time': executionTime,
                            });
                        }
                        clearTimeout(module.performance.timer);
                        module.performance.timer = setTimeout(function () {
                            module.performance.display();
                        }, 500);
                    },
                    display: function () {
                        var
                            title = settings.name + ':',
                            totalTime = 0
                        ;
                        time = false;
                        clearTimeout(module.performance.timer);
                        $.each(performance, function (index, data) {
                            totalTime += data['Execution Time'];
                        });
                        title += ' ' + totalTime + 'ms';
                        if ($allModules.length > 1) {
                            title += ' (' + $allModules.length + ')';
                        }
                        if (performance.length > 0) {
                            console.groupCollapsed(title);
                            if (console.table) {
                                console.table(performance);
                            } else {
                                $.each(performance, function (index, data) {
                                    console.log(data.Name + ': ' + data['Execution Time'] + 'ms');
                                });
                            }
                            console.groupEnd();
                        }
                        performance = [];
                    },
                },
                invoke: function (query, passedArguments, context) {
                    var
                        object = instance,
                        maxDepth,
                        found,
                        response
                    ;
                    passedArguments = passedArguments || queryArguments;
                    context = context || element;
                    if (typeof query === 'string' && object !== undefined) {
                        query = query.split(/[ .]/);
                        maxDepth = query.length - 1;
                        $.each(query, function (depth, value) {
                            var camelCaseValue = depth !== maxDepth
                                ? value + query[depth + 1].charAt(0).toUpperCase() + query[depth + 1].slice(1)
                                : query
                            ;
                            if ($.isPlainObject(object[camelCaseValue]) && (depth !== maxDepth)) {
                                object = object[camelCaseValue];
                            } else if (object[camelCaseValue] !== undefined) {
                                found = object[camelCaseValue];

                                return false;
                            } else if ($.isPlainObject(object[value]) && (depth !== maxDepth)) {
                                object = object[value];
                            } else if (object[value] !== undefined) {
                                found = object[value];

                                return false;
                            } else {
                                module.error(error.method, query);

                                return false;
                            }
                        });
                    }
                    if (isFunction(found)) {
                        response = found.apply(context, passedArguments);
                    } else if (found !== undefined) {
                        response = found;
                    }
                    if (Array.isArray(returnedValue)) {
                        returnedValue.push(response);
                    } else if (returnedValue !== undefined) {
                        returnedValue = [returnedValue, response];
                    } else if (response !== undefined) {
                        returnedValue = response;
                    }

                    return found;
                },
            };
            if (methodInvoked) {
                if (instance === undefined) {
                    module.initialize();
                }
                module.invoke(query);
            } else {
                if (instance !== undefined) {
                    instance.invoke('destroy');
                }
                module.initialize();
            }
        });

        return returnedValue !== undefined
            ? returnedValue
            : this;
    };

    $.fn.search.settings = {

        name: 'Search',
        namespace: 'search',

        silent: false,
        debug: false,
        verbose: false,
        performance: true,

        // template to use (specified in settings.templates)
        type: 'standard',

        // minimum characters required to search
        minCharacters: 1,

        // whether to select first result after searching automatically
        selectFirstResult: false,

        // API config
        apiSettings: false,

        // object to search
        source: false,

        // Whether search should query current term on focus
        searchOnFocus: true,

        // fields to search
        searchFields: [
            'id',
            'title',
            'description',
        ],

        // field to display in standard results template
        displayField: '',

        // search anywhere in value (set to 'exact' to require exact matches
        fullTextSearch: 'exact',

        // Whether search result should highlight matching strings
        highlightMatches: false,

        // match results also if they contain diacritics of the same base character (for example searching for "a" will also match "á" or "â" or "à", etc...)
        ignoreDiacritics: false,

        // whether to consider case sensitivity on local searching
        ignoreSearchCase: true,

        // whether to add events to prompt automatically
        automatic: true,

        // delay before hiding menu after blur
        hideDelay: 0,

        // delay before searching
        searchDelay: 200,

        // maximum results returned from search
        maxResults: 7,

        // whether to store lookups in local cache
        cache: true,

        // whether no results errors should be shown
        showNoResults: true,

        // preserve possible html of resultset values
        preserveHTML: true,

        // transition settings
        transition: 'scale',
        duration: 200,
        easing: 'easeOutExpo',

        // callbacks
        onSelect: false,
        onResultsAdd: false,

        onSearchQuery: function (query) {},
        onResults: function (response, fromCache) {},

        onResultsOpen: function () {},
        onResultsClose: function () {},

        className: {
            animating: 'animating',
            active: 'active',
            category: 'category',
            empty: 'empty',
            focus: 'focus',
            hidden: 'hidden',
            loading: 'loading',
            results: 'results',
            pressed: 'down',
        },

        error: {
            source: 'Cannot search. No source used, and Fomantic API module was not included',
            noResultsHeader: 'No Results',
            noResults: 'Your search returned no results',
            noTemplate: 'A valid template name was not specified.',
            oldSearchSyntax: 'searchFullText setting has been renamed fullTextSearch for consistency, please adjust your settings.',
            serverError: 'There was an issue querying the server.',
            maxResults: 'Results must be an array to use maxResults setting',
            method: 'The method you called is not defined.',
            noNormalize: '"ignoreDiacritics" setting will be ignored. Browser does not support String().normalize(). You may consider including <https://cdn.jsdelivr.net/npm/unorm@1.4.1/lib/unorm.min.js> as a polyfill.',
        },

        metadata: {
            cache: 'cache',
            results: 'results',
            result: 'result',
        },

        regExp: {
            escape: /[$()*+./?[\\\]^{|}-]/g,
            beginsWith: '(?:\\s|^)',
        },

        // maps api response attributes to internal representation
        fields: {
            categories: 'results', // array of categories (category view)
            categoryName: 'name', // name of category (category view)
            categoryResults: 'results', // array of results (category view)
            description: 'description', // result description
            image: 'image', // result image
            alt: 'alt', // result alt text for image
            price: 'price', // result price
            results: 'results', // array of results (standard)
            title: 'title', // result title
            url: 'url', // result url
            action: 'action', // "view more" object name
            actionText: 'text', // "view more" text
            actionURL: 'url', // "view more" url
        },

        selector: {
            prompt: '.prompt',
            remove: '> .icon.input > .remove.icon',
            searchButton: '.search.button',
            results: '.results',
            message: '.results > .message',
            category: '.category',
            result: '.result',
            title: '.title, .name',
        },

        templates: {
            escape: function (string, preserveHTML) {
                if (preserveHTML) {
                    return string;
                }
                var
                    badChars     = /["'<>`]/g,
                    shouldEscape = /["&'<>`]/,
                    escape       = {
                        '<': '&lt;',
                        '>': '&gt;',
                        '"': '&quot;',
                        "'": '&#x27;',
                        '`': '&#x60;',
                    },
                    escapedChar  = function (chr) {
                        return escape[chr];
                    };
                if (shouldEscape.test(string)) {
                    string = string.replace(/&(?![\d#a-z]{1,12};)/gi, '&amp;');
                    string = string.replace(badChars, escapedChar);
                    // FUI controlled HTML is still allowed
                    string = string.replace(/&lt;(\/)*mark&gt;/g, '<$1mark>');
                }

                return string;
            },
            message: function (message, type, header) {
                var
                    html = ''
                ;
                if (message !== undefined && type !== undefined) {
                    html += ''
                        + '<div class="message ' + type + '">';
                    if (header) {
                        html += ''
                            + '<div class="header">' + header + '</div>';
                    }
                    html += ' <div class="description">' + message + '</div>';
                    html += '</div>';
                }

                return html;
            },
            category: function (response, fields, preserveHTML) {
                var
                    html = '',
                    escape = $.fn.search.settings.templates.escape
                ;
                if (response[fields.categoryResults] !== undefined) {
                    // each category
                    $.each(response[fields.categoryResults], function (index, category) {
                        if (category[fields.results] !== undefined && category.results.length > 0) {
                            html += '<div class="category">';

                            if (category[fields.categoryName] !== undefined) {
                                html += '<div class="name">' + escape(category[fields.categoryName], preserveHTML) + '</div>';
                            }

                            // each item inside category
                            html += '<div class="results">';
                            $.each(category.results, function (index, result) {
                                html += result[fields.url]
                                    ? '<a class="result" href="' + result[fields.url].replace(/"/g, '') + '">'
                                    : '<a class="result">';
                                if (result[fields.image] !== undefined) {
                                    html += ''
                                        + '<div class="image">'
                                        + ' <img src="' + result[fields.image].replace(/"/g, '') + (result[fields.alt] ? '" alt="' + result[fields.alt].replace(/"/g, '') : '') + '">'
                                        + '</div>';
                                }
                                html += '<div class="content">';
                                if (result[fields.price] !== undefined) {
                                    html += '<div class="price">' + escape(result[fields.price], preserveHTML) + '</div>';
                                }
                                if (result[fields.title] !== undefined) {
                                    html += '<div class="title">' + escape(result[fields.title], preserveHTML) + '</div>';
                                }
                                if (result[fields.description] !== undefined) {
                                    html += '<div class="description">' + escape(result[fields.description], preserveHTML) + '</div>';
                                }
                                html += ''
                                    + '</div>';
                                html += '</a>';
                            });
                            html += '</div>';
                            html += ''
                                + '</div>';
                        }
                    });
                    if (response[fields.action]) {
                        html += fields.actionURL === false
                            ? ''
                                + '<div class="action">'
                                + escape(response[fields.action][fields.actionText], preserveHTML)
                                + '</div>'
                            : ''
                                + '<a href="' + response[fields.action][fields.actionURL].replace(/"/g, '') + '" class="action">'
                                + escape(response[fields.action][fields.actionText], preserveHTML)
                                + '</a>';
                    }

                    return html;
                }

                return false;
            },
            standard: function (response, fields, preserveHTML) {
                var
                    html = '',
                    escape = $.fn.search.settings.templates.escape
                ;
                if (response[fields.results] !== undefined) {
                    // each result
                    $.each(response[fields.results], function (index, result) {
                        html += result[fields.url]
                            ? '<a class="result" href="' + result[fields.url].replace(/"/g, '') + '">'
                            : '<a class="result">';
                        if (result[fields.image] !== undefined) {
                            html += ''
                                + '<div class="image">'
                                + ' <img src="' + result[fields.image].replace(/"/g, '') + (result[fields.alt] ? '" alt="' + result[fields.alt].replace(/"/g, '') : '') + '">'
                                + '</div>';
                        }
                        html += '<div class="content">';
                        if (result[fields.price] !== undefined) {
                            html += '<div class="price">' + escape(result[fields.price], preserveHTML) + '</div>';
                        }
                        if (result[fields.title] !== undefined) {
                            html += '<div class="title">' + escape(result[fields.title], preserveHTML) + '</div>';
                        }
                        if (result[fields.description] !== undefined) {
                            html += '<div class="description">' + escape(result[fields.description], preserveHTML) + '</div>';
                        }
                        html += ''
                            + '</div>';
                        html += '</a>';
                    });
                    if (response[fields.action]) {
                        html += fields.actionURL === false
                            ? ''
                                + '<div class="action">'
                                + escape(response[fields.action][fields.actionText], preserveHTML)
                                + '</div>'
                            : ''
                                + '<a href="' + response[fields.action][fields.actionURL].replace(/"/g, '') + '" class="action">'
                                + escape(response[fields.action][fields.actionText], preserveHTML)
                                + '</a>';
                    }

                    return html;
                }

                return false;
            },
        },
    };

    $.extend($.easing, {
        easeOutExpo: function (x) {
            return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
        },
    });
})(jQuery, window, document);
