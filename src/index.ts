const prefix = "/";

import CMComm from "./CMC.js";
import Logger from "./Logger.js";

import crypto from "node:crypto";

let cmc = new CMComm();

let logger = new Logger(cmc);

let db_cmd: {
    [namespace: string]: {
        [cmd: string]: {
            funcName: string;
            description: {
                fallback: string,
                [ISOLanguageCode: string]: string
            };
            args: {
                fallback: string,
                [ISOLanguageCode: string]: string
            };
            argsName: string[],
            compatibility: string[]
        }
    }
} = {};

let default_db_cmd: {
    [cmd: string]: {
        pointer: string
    }
} = {};

// Get persistent data first
let call = await cmc.callAPI("core", "get_persistent_data", null);
if (call.exist) {
    let d = call.data;

    if (typeof d === "object") {
        db_cmd = d.db_cmd ?? {};
        default_db_cmd = d.default_db_cmd ?? {};
    }
}

// Get default database
let defaultDB = {
    id: 0,
    resolver: ""
};
call = await cmc.callAPI("core", "get_default_db", null);
if (call.exist) {
    let d = call.data;

    if (typeof d === "object") {
        defaultDB = {
            id: d.databaseID,
            resolver: d.resolver
        }
    }
}

cmc.on("api:register_cmd", async (call_from: string, data: {
    namespace: string;
    command: string;
    funcName: string;
    description: {
        fallback: string,
        [ISOLanguageCode: string]: string
    };
    args: {
        fallback: string,
        [ISOLanguageCode: string]: string
    };
    argsName?: string[];
    compatibility?: string[];
}, callback: (error?: any, data?: any) => void) => {
    if (!db_cmd[data.namespace]) {
        db_cmd[data.namespace] = {};
    }

    if (db_cmd[data.namespace][data.command]) {
        callback("Command already registered", {
            success: false,
            error: "Command already registered"
        });
        return;
    }

    db_cmd[data.namespace][data.command] = {
        funcName: data.funcName,
        description: data.description ?? { fallback: "" },
        args: data.args ?? { fallback: "" },
        argsName: Array.isArray(data.argsName) ? data.argsName : [],
        compatibility: Array.isArray(data.compatibility) ? data.compatibility : []
    }

    if (default_db_cmd[data.command]) {
        logger.warn("cmdhandler", `Command ${data.namespace}:${data.command} is conflicting with ${default_db_cmd[data.command].pointer} (registered as default). This command will only be called using namespaces.`);
    } else {
        default_db_cmd[data.command] = {
            pointer: `${data.namespace}:${data.command}`
        }
    }

    await cmc.callAPI("core", "set_persistent_data", {
        db_cmd: db_cmd,
        default_db_cmd: default_db_cmd
    });

    await cmc.callAPI("core", "send_event", {
        eventName: "cmdhandler_regevent",
        data: {
            isRegisterEvent: true,
            namespace: data.namespace,
            command: data.command,
            description: data.description ?? { fallback: "" },
            args: data.args ?? { fallback: "" },
            argsName: Array.isArray(data.argsName) ? data.argsName : [],
            compatibility: Array.isArray(data.compatibility) ? data.compatibility : []
        }
    });

    logger.info("cmdhandler", `Command ${data.namespace}:${data.command} registered by module ID ${call_from}.`);

    callback(null, {
        success: true
    });
});

cmc.on("api:unregister_cmd", async (call_from: string, data: {
    namespace: string;
    command: string;
}, callback: (error?: any, data?: any) => void) => {
    if (!db_cmd[data.namespace]) {
        callback("Namespace not found", {
            success: false,
            error: "Namespace not found"
        });
        return;
    }

    if (!db_cmd[data.namespace][data.command]) {
        callback("Command not found", {
            success: false,
            error: "Command not found"
        });
        return;
    }

    delete db_cmd[data.namespace][data.command];
    delete default_db_cmd[data.command];

    await cmc.callAPI("core", "set_persistent_data", {
        db_cmd: db_cmd,
        default_db_cmd: default_db_cmd
    });

    await cmc.callAPI("core", "send_event", {
        eventName: "cmdhandler_regevent",
        data: {
            isRegisterEvent: false,
            namespace: data.namespace,
            command: data.command
        }
    });

    logger.info("cmdhandler", `Command ${data.namespace}:${data.command} unregistered by ${call_from}.`);
    callback(null, {
        success: true
    });
});

cmc.on("api:cmd_list", (call_from: string, data: any, callback: (error?: any, data?: any) => void) => {
    let cmds: ({
        namespace: string;
        command: string;
        funcName: string;
        description: {
            fallback: string,
            [ISOLanguageCode: string]: string
        };
        args: {
            fallback: string,
            [ISOLanguageCode: string]: string
        };
        argsName: string[];
        compatibility: string[];
    })[] = [];

    for (let namespace in db_cmd) {
        for (let cmd in db_cmd[namespace]) {
            cmds.push({
                namespace,
                command: cmd,
                funcName: db_cmd[namespace][cmd].funcName,
                description: db_cmd[namespace][cmd].description,
                args: db_cmd[namespace][cmd].args,
                argsName: db_cmd[namespace][cmd].argsName,
                compatibility: db_cmd[namespace][cmd].compatibility
            });
        }
    }

    callback(null, {
        commands: cmds,
        count: cmds.length
    });
});

let randomAPIKey = crypto.randomBytes(48).toString("hex");
cmc.on(`api:${randomAPIKey}`, async (call_from: string, data: {
    calledFrom: string;
    eventName: string;
    eventData: any;
}, callback: (error?: any, data?: any) => void) => {
    if (call_from != "core") {
        callback(null, false);
        return;
    }

    if (data.eventName === "interface_message") {
        let msg = data.eventData as {
            content: string,
            attachments: {
                filename: string,
                url: string
            }[],
            mentions: {
                [formattedUserID: string]: {
                    start: number,
                    length: number
                }
            },
            interfaceHandlerName: string,
            interfaceID: number,
            messageID: string,
            formattedMessageID: string,
            channelID: string,
            formattedChannelID: string,
            guildID: string,
            formattedGuildID: string,
            senderID: string,
            formattedSenderID: string,
            language?: string,
            additionalInterfaceData?: any
        };

        if (msg.language) {
            // Save to database
            await cmc.callAPI(defaultDB.resolver, "set_data", {
                databaseID: defaultDB.id,
                table: "command_handler_lang_o",
                key: msg.formattedSenderID,
                value: msg.language
            });
        }

        if (msg.content.startsWith(prefix)) {
            let c = msg.content.substring(prefix.length);

            // Parse msg.content: split command and args
            // Note: content inside "" is considered as a single argument
            let args = c
                .replace((/”/g), "\"")
                .replace((/“/g), "\"")
                .split(/((?:"[^"\\]*(?:\\[\S\s][^"\\]*)*"|'[^'\\]*(?:\\[\S\s][^'\\]*)*'|\/[^/\\]*(?:\\[\S\s][^/\\]*)*\/[gimy]*(?=\s|$)|(?:\\\s|\S))+)(?=\s|$)/)
                .filter(function (el) {
                    return !(el == null || el == "" || el == " " || !el.replace(/\s/g, '')
                        .length);
                })
                .map(function (z) {
                    return z.replace(/"/g, "");
                });

            let cmd = args.shift();
            if (!cmd) return;

            let pointed_cmd: {
                funcName: string;
                compatibility: string[];
                namespace: string;
                command: string;
            } | undefined = void 0;
            let namespaceSplit = cmd.split(":");
            if (namespaceSplit.length === 1) {
                // Handle default commands
                if (!default_db_cmd[cmd]) {
                    return;
                }

                // Resolve pointer
                let target = db_cmd
                [default_db_cmd[cmd].pointer.split(":")[0]]
                [default_db_cmd[cmd].pointer.split(":")[1]];

                if (target) {
                    pointed_cmd = {
                        funcName: target.funcName,
                        namespace: default_db_cmd[cmd].pointer.split(":")[0],
                        command: default_db_cmd[cmd].pointer.split(":")[1],
                        compatibility: target.compatibility
                    };
                }
            } else {
                // Handle namespaced commands
                let namespace = namespaceSplit[0];
                let cmd = namespaceSplit[1];
                if (!db_cmd[namespace]) {
                    return;
                }

                if (!db_cmd[namespace][cmd]) {
                    return;
                }

                let target = db_cmd[namespace][cmd];
                pointed_cmd = {
                    funcName: target.funcName,
                    namespace: namespace,
                    command: cmd,
                    compatibility: target.compatibility
                };
            }

            if (!pointed_cmd) return;
            // Compatibility check
            if (
                pointed_cmd.compatibility.length !== 0 &&
                pointed_cmd.compatibility.indexOf(msg.interfaceHandlerName) === -1
            ) return;

            // Get module responsible for the namespace
            let mInfoRaw = await cmc.callAPI("core", "get_plugin_namespace_info", {
                namespace: pointed_cmd.namespace
            });
            if (mInfoRaw.exist) {
                let mInfo = mInfoRaw.data as (({
                    exist: true;
                    pluginName: string;
                    version: string;
                    author: string;
                    resolver: string;
                }) | ({ exist: false }));

                // Call command
                if (mInfo.exist) {
                    // Check for operator status
                    let isOperator = false;
                    let operatorList = await cmc.callAPI("core", "get_operator_list", null);
                    if (operatorList.exist) {
                        if (operatorList.data.indexOf(msg.formattedSenderID) !== -1) {
                            isOperator = true;
                        }
                    }

                    let resp = (await cmc.callAPI(mInfo.resolver, "plugin_call", {
                        namespace: pointed_cmd.namespace,
                        funcName: pointed_cmd.funcName,
                        args: [{
                            interfaceID: msg.interfaceID,
                            interfaceHandlerName: msg.interfaceHandlerName,

                            cmd: pointed_cmd.command,
                            args: args,
                            attachments: msg.attachments,
                            mentions: msg.mentions,

                            messageID: msg.messageID,
                            formattedMessageID: msg.formattedMessageID,
                            channelID: msg.channelID,
                            formattedChannelID: msg.formattedChannelID,
                            guildID: msg.guildID,
                            formattedGuildID: msg.formattedGuildID,
                            senderID: msg.senderID,
                            formattedSenderID: msg.formattedSenderID,

                            originalContent: msg.content,
                            prefix: "/",
                            language: (await getLang({
                                formattedUserID: msg.formattedSenderID,
                                formattedChannelID: msg.formattedChannelID,
                                formattedGuildID: msg.formattedGuildID
                            })).language,
                            isOperator,
                            additionalInterfaceData: msg.additionalInterfaceData
                        }]
                    }));

                    if (resp.exist && resp.data && resp.data.returnData) {
                        let rtData = resp.data.returnData as {
                            content: string,
                            attachments?: {
                                filename: string,
                                url: string
                            }[],
                            additionalInterfaceData: any
                        };

                        await cmc.callAPI(data.calledFrom, "send_message", {
                            interfaceID: msg.interfaceID,
                            content: rtData.content,
                            attachments: rtData.attachments,
                            channelID: msg.channelID,
                            replyMessageID: msg.messageID,
                            additionalInterfaceData: rtData.additionalInterfaceData
                        });
                    }
                }
            }
        }
    }
});

cmc.on(
    "api:get_default_lang",
    (call_from: string, data: any, callback: (error?: any, data?: any) => void) => {
        callback(null, {
            language: cmc.config.language ?? "en_US"
        });
    }
);

cmc.on(
    "api:get_lang",
    async (call_from: string, data: (
        {
            formattedUserID?: string,
            formattedChannelID?: string,
            formattedGuildID?: string
        }
    ), callback: (error?: any, data?: any) => void) => {
        let lang = await getLang(data);

        callback(null, {
            lang: lang.language,
            isDefault: lang.isDefault,
            isInterfaceGiven: lang.isInterfaceGiven,
            isOverriden: lang.isOverriden
        });
    }
);

cmc.on("api:set_lang", async (call_from: string, data: (
    {
        formattedUserID?: string,
        formattedChannelID?: string,
        formattedGuildID?: string,
        lang: string
    }
), callback: (error?: any, data?: any) => void) => {
    if (data.formattedUserID) {
        await cmc.callAPI(defaultDB.resolver, "set_data", {
            databaseID: defaultDB.id,
            table: "command_handler_lang_o",
            key: data.formattedGuildID,
            value: data.lang
        });
    }

    if (data.formattedChannelID) {
        await cmc.callAPI(defaultDB.resolver, "set_data", {
            databaseID: defaultDB.id,
            table: "command_handler_lang_o",
            key: data.formattedChannelID,
            value: data.lang
        });
    }

    if (data.formattedGuildID) {
        await cmc.callAPI(defaultDB.resolver, "set_data", {
            databaseID: defaultDB.id,
            table: "command_handler_lang_o",
            key: data.formattedGuildID,
            value: data.lang
        });
    }

    callback(null, {
        success: true
    });
});

async function getLang(data: {
    formattedUserID?: string,
    formattedChannelID?: string,
    formattedGuildID?: string
}) {
    let lang = cmc.config.language ?? "en_US";
    let t = 0;

    if (data.formattedGuildID) {
        // Check in database
        let langDB = await cmc.callAPI(defaultDB.resolver, "get_data", {
            databaseID: defaultDB.id,
            table: "command_handler_lang_o",
            key: data.formattedGuildID
        });
        if (langDB.exist && langDB.data?.success) {
            lang = langDB.data?.data ?? lang;
            if (langDB.data?.data) {
                t = 1;
            }
        }
    }

    if (data.formattedChannelID) {
        // Check in database
        let langDB = await cmc.callAPI(defaultDB.resolver, "get_data", {
            databaseID: defaultDB.id,
            table: "command_handler_lang_o",
            key: data.formattedChannelID
        });
        if (langDB.exist && langDB.data?.success) {
            lang = langDB.data?.data ?? lang;
            if (langDB.data?.data) {
                t = 1;
            }
        }
    }

    if (data.formattedUserID) {
        // Check in database
        let langDB = await cmc.callAPI(defaultDB.resolver, "get_data", {
            databaseID: defaultDB.id,
            table: "command_handler_lang_o",
            key: data.formattedUserID
        });
        if (langDB.exist && langDB.data?.success) {
            lang = langDB.data?.data ?? lang;
            if (langDB.data?.data) {
                t = 1;
            }
        }

        // Check in database for interface-given language
        langDB = await cmc.callAPI(defaultDB.resolver, "get_data", {
            databaseID: defaultDB.id,
            table: "command_handler_lang_i",
            key: data.formattedUserID
        });
        if (langDB.exist && langDB.data?.success) {
            lang = langDB.data?.data ?? lang;
            if (langDB.data?.data) {
                t = 2;
            }
        }
    }

    return {
        language: lang,
        isDefault: t === 0,
        isOverriden: t === 1,
        isInterfaceGiven: t === 2
    }
}

cmc.callAPI("core", "register_event_hook", {
    callbackFunction: randomAPIKey,
    eventName: "interface_message"
});
