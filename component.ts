declare const Rx: any;


function proxify(o) {
    function buildProxy(prefix, o) {
        return new Proxy(o, {
            set: function(target, propertyName, value) {
                // same as before, but add prefix
                console.log(`${propertyName} has been changed from ${target[propertyName]} to ${value}`);
                if (target[propertyName] !== value) {
                    const changes = {[propertyName]: {previousValue: target[propertyName], currentValue: value}};
                    if (target.__changeDetector) target.__changeDetector.next(changes);
                    if (target.onComponentChanges && typeof target.onComponentChanges === 'function') {
                        setTimeout(() => target.onComponentChanges(changes));
                    }
                }
                target[propertyName] = value;
                return true;
            },
            get: function(target, property) {
                // return a new proxy if possible, add to prefix
                let out = target[property];
                if (out instanceof Object) {
                    return buildProxy(prefix + property + '.', out);
                }
                return out;  // primitive, ignore
            },
        });
    }

    return buildProxy('', o);
}

interface VirtualDOM {
    tagName: string,
    attributes: {[key: string]: string},
    children: VirtualDOM[];
    content?: string;
}

function recursiveParse(nodes: NodeList): VirtualDOM[] {
    const vdomList: VirtualDOM [] = [];
    for (let i = 0; i < nodes.length; i++) {
        const vdom: VirtualDOM = <VirtualDOM>{};
        const node = nodes[i];
        vdom.tagName = node.nodeName;
        if (vdom.tagName === '#text') {
            vdom.content = node.textContent;
        }
        vdom.attributes = {};
        if (node.attributes) {
            for (let j = 0; j < node.attributes.length; j++) {
                const attribute = node.attributes[j];
                vdom.attributes[attribute.name] = attribute.textContent;
            }
        }
        vdom.children = recursiveParse(node.childNodes);
        vdomList.push(vdom);
    }
    return vdomList;
}

function Component(options: {template: string, selector: string}) {
    return function <T extends { new(...args: any[]): {} }>(beforeConstructor: T) {
        const parser = new DOMParser();
        const vdomXML = parser.parseFromString(options.template, 'text/xml');
        const vdomList: VirtualDOM[] = recursiveParse(vdomXML.childNodes);



        return class extends beforeConstructor {
            static __virtualDom: VirtualDOM[] = vdomList;
            static __selector: string = options.selector;
            __changeDetector = new Rx.BehaviorSubject(null);
            constructor(...args: any[]) {
                super();
                return proxify(this);
            }
        }
    }
}

function Watch(property: string) {
    return function (target, method) {
        // if (!(property in target)) {
        //     throw ReferenceError(`Property ${property} does not exist`)
        // }
        console.log(target, method);
    }
}

class Module {
    componentSelectorMapping: {[key: string]: any} = {};
    constructor(components: any[], rootElement: HTMLElement) {
        for (const component of components) {
            this.componentSelectorMapping[component.__selector] = component;
        }
        console.log(this.componentSelectorMapping);
        if (!(rootElement.nodeName.toLowerCase() in this.componentSelectorMapping)) {
            throw TypeError('Root should be a valid component');
        }
        const rootComponent = this.componentSelectorMapping[rootElement.nodeName.toLowerCase()];
        this.renderNodeList(rootComponent.__virtualDom, rootElement, rootComponent);
    }

    private renderNodeList(nodeList: any, parent: HTMLElement, component: any) {
        const componentInstance = new component();
        for (const node of nodeList) {
            if (node.tagName.toLowerCase() in this.componentSelectorMapping) {
                const container = document.createElement(node.tagName);
                parent.appendChild(container);
                const componentClass = this.componentSelectorMapping[node.tagName.toLowerCase()];
                this.renderNodeList(componentClass.__virtualDom, container, componentClass);
            } else if (node.tagName === '#text') {
                const text = document.createTextNode(node.content);
                parent.appendChild(text);
            } else {
                const element = document.createElement(node.tagName);
                for (const attrName in node.attributes) {
                    if (attrName.startsWith('on-')) {
                        const eventName: string = attrName.slice(3, attrName.length);
                        const methodNameEndIndex = node.attributes[attrName].lastIndexOf('(');
                        const methodName = node.attributes[attrName].slice(0, methodNameEndIndex);
                        element.addEventListener(eventName, event => componentInstance[methodName]());
                    } else if (node.attributes.hasOwnProperty(attrName)) {
                        let finalAttrName: string;
                        if (attrName.startsWith('bind-')) {
                            finalAttrName = attrName.slice(5, attrName.length);
                            const attr = node.attributes[attrName];
                            componentInstance.__changeDetector
                                .filter(changes => changes && changes[attr])
                                .subscribe(changes => element[finalAttrName] = changes[attr].currentValue);
                        } else {
                            element[attrName + (attrName === 'class' ? 'Name' : '')] = node.attributes[attrName];
                        }
                    }
                }
                this.renderNodeList(node.children, element, component);
                parent.appendChild(element);
            }
        }
    }
}

@Component({
    template: `<div class="alert" style="background-color: aqua">
                <button on-click="changeContent()">Click me!</button>
                    Hello
                    <nested></nested>
                    <nested></nested>
                    <nested></nested>
                    <nested></nested>
                    <nested></nested>
                <span bind-hidden="isButtonInVisible">I am togglable!</span>
            </div>`,
    selector: 'greeter'
})
class Greeter {
    property = "property";
    hello: string;
    isButtonInVisible: boolean = false;
    impedimenta: number[] = [];
    constructor(m: string) {
        this.hello = m;
    }

    onComponentChanges(changes) {
        console.log(changes);
    }

    @Watch('hello')
    onHelloChange(previous: string, current: string) {
        console.log(previous);
    }

    changeContent(): void {
        this.isButtonInVisible = !this.isButtonInVisible;
    }
}

@Component({
    template: `<p>Paragpaph is nested!</p>`,
    selector: 'nested'
})
class ParagraphComponent {}

const mdl = new Module([Greeter, ParagraphComponent], document.getElementById('root'));