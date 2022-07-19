import CMComm from "./CMC";
import Logger from "./Logger";

import crypto from "node:crypto";

let cmc = new CMComm();

let logger = new Logger(cmc);

let db_cmd: {
    [namespace: string]: {
        [cmd: string]: {
            funcName: string;
            funcDescAPI: string;
        }
    }
} = {};

let default_db_cmd: {
    [cmd: string]: {
        pointer: string
    }
} = {};

cmc.on("api:register_cmd", (call_from: string, data: {
    namespace: string;
    command: string;
    funcName: string;
    funcDescAPI: string;
}, callback: (error?: any, data?: any) => void) => {
    if (!db_cmd[data.namespace]) {
        db_cmd[data.namespace] = {};
    }

    if (db_cmd[data.namespace][data.command]) {
        callback({
            success: false,
            error: "Command already registered"
        });
        return;
    }

    db_cmd[data.namespace][data.command] = {
        funcName: data.funcName,
        funcDescAPI: data.funcDescAPI
    }

    if (default_db_cmd[data.command]) {
        logger.warn(`Command ${data.namespace}:${data.command} is conflicting with ${default_db_cmd[data.command].pointer} (registered as default). This command will only be called using namespaces.`);
    } else {
        default_db_cmd[data.command] = {
            pointer: `${data.namespace}:${data.command}`
        }
    }

    logger.info(`Command ${data.namespace}:${data.command} registered by ${call_from}.`);

    callback({
        success: true
    });
});

cmc.on("api:unregister_cmd", (call_from: string, data: {
    namespace: string;
    command: string;
}, callback: (error?: any, data?: any) => void) => {
    if (!db_cmd[data.namespace]) {
        callback({
            success: false,
            error: "Namespace not found"
        });
        return;
    }

    if (!db_cmd[data.namespace][data.command]) {
        callback({
            success: false,
            error: "Command not found"
        });
        return;
    }

    delete db_cmd[data.namespace][data.command];
    delete default_db_cmd[data.command];
    logger.info(`Command ${data.namespace}:${data.command} unregistered by ${call_from}.`);
    callback({
        success: true
    });
});

cmc.on("api:cmd_list", (call_from: string, data: any, callback: (error?: any, data?: any) => void) => {
    let cmds: ({
        namespace: string;
        command: string;
        funcName: string;
        funcDescAPI: string;
    })[] = [];

    for (let namespace in db_cmd) {
        for (let cmd in db_cmd[namespace]) {
            cmds.push({
                namespace,
                command: cmd,
                funcName: db_cmd[namespace][cmd].funcName,
                funcDescAPI: db_cmd[namespace][cmd].funcDescAPI
            });
        }
    }

    callback({
        commands: cmds,
        count: cmds.length
    });
});

let randomAPIKey = crypto.randomBytes(48).toString("hex");
cmc.on(`api:${randomAPIKey}`, (call_from: string, data: {
    calledFrom: string;
    eventName: string;
    eventData: any;
}, callback: (error?: any, data?: any) => void) => {
    if (call_from != "core") {
        callback(false);
        return;
    }

    if (data.eventName === "interface_message") {
        let msg = data.eventData as {
            content: string,
            attachments: {
                filename: string,
                url: string
            }[],
            interfaceHandlerName: string,
            interfaceID: number,
            additionalInterfaceData?: any
        };

        // Parse msg.content: split command and args
        // Note: content inside "" is considered as a single argument
        let args = msg.content
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
            funcDescAPI: string;
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
                    funcDescAPI: target.funcDescAPI,
                    namespace: default_db_cmd[cmd].pointer.split(":")[0],
                    command: default_db_cmd[cmd].pointer.split(":")[1]
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
                funcDescAPI: target.funcDescAPI,
                namespace: namespace,
                command: cmd
            };
        }

        if (!pointed_cmd) return;

        // Call command
        
    }
});

cmc.callAPI("core", "register_event_hook", {
    callbackFunction: randomAPIKey,
    event: "interface_message"
});