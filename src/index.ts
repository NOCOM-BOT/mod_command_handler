import CMComm from "./CMC";
import Logger from "./Logger";

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


