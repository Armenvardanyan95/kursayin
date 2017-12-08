declare const Rx: any;


function getPropValue(propertyWithPrefixes: string, obj): any {
    const propArray: string[] = propertyWithPrefixes.split('.');
    return propArray.reduce((final, prop) => final = final[prop], obj)
}

function setPropValue(propertyWithPrefixes: string, target, value: any): void {
    const propArray: string[] = propertyWithPrefixes.split('.');
    if (propArray.length === 1) {
        target[propArray[0]] = value;
        return;
    }
    const upperMostNestedObject = getPropValue(propArray.slice(0, propArray.length - 1).join('.'), target);
    upperMostNestedObject[propArray[propArray.length - 1]] = value;
}

function proxify(o, changeDetector) {
    function buildProxy(prefix, o) {
        return new Proxy(o, {
            set: function(target, propertyName, value) {
                // same as before, but add prefix
                console.log(`${prefix}${propertyName} has been changed from ${target[propertyName]} to ${value}`);
                if (target[propertyName] !== value) {
                    const changes = {[prefix + propertyName]: {previousValue: target[propertyName], currentValue: value}};
                    if (changeDetector) changeDetector.next(changes);
                    if (target.onComponentChanges && typeof target.onComponentChanges === 'function') {
                        setTimeout(() => target.onComponentChanges(changes));
                    }
                    for (const prop in target) {
                        if (typeof target[prop] === 'function' && target[prop].__watches === prefix + propertyName) {
                            target[prop](target[propertyName], value);
                        }
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
                return proxify(this, this.__changeDetector);
            }
        }
    }
}

function Watch(property: string) {
    return function (target, method) {
        target[method].__watches = property;
        console.log(target);
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
                        Rx.Observable.fromEvent(element, eventName).subscribe(event => componentInstance[methodName]())
                    } else if (node.attributes.hasOwnProperty(attrName)) {
                        let finalAttrName: string;
                        if (attrName === 'bind-model') {
                            if (node.tagName !== 'input') {
                                throw TypeError('You can only bind a model to an input element');
                            }
                            const bindingName: string = node.attributes[attrName];
                            element.value = getPropValue(bindingName, componentInstance);
                            componentInstance.__changeDetector
                                .filter(changes => changes && changes[bindingName])
                                .subscribe((changes) => element.value = changes[bindingName].currentValue);

                            Rx.Observable
                                .fromEvent(element, 'input')
                                .subscribe(() => setPropValue(bindingName, componentInstance, element.value));
                        }
                        if (attrName.startsWith('bind-')) {
                            finalAttrName = attrName.slice(5, attrName.length);
                            const bindingName = node.attributes[attrName];
                            const attrValue = getPropValue(bindingName, componentInstance);
                            element[finalAttrName] = attrValue;
                            componentInstance.__changeDetector
                                .filter(changes => changes && changes[bindingName])
                                .subscribe(changes => element[finalAttrName] = changes[bindingName].currentValue);
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
                    Hello <input type="text" bind-model="hello"/>
                    <span bind-innerText="user.name">Hover me</span>
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
    property: string = "property";
    hello: string = 'Private';
    isButtonInVisible: boolean = false;
    impedimenta: number[] = [];
    user = {name: 'Armen'};
    nestedObject = {name: 'Armen', anotherNested: {nested: 'privet'}};

    onComponentChanges(changes) {
        console.log(changes);
    }

    @Watch('hello')
    onHelloChange(previous: string, current: string) {
        console.log(previous, 'jaaaan change ashxatum a');
    }

    changeContent(): void {
        this.isButtonInVisible = !this.isButtonInVisible;
        this.user.name = 'Vardanyan';
    }
}

@Component({
    template: `<p>Paragpaph is nested!
                <a on-click="greet()">Hi!
                </a>
                <span bind-innerText="greetText"></span>
                <input type="text" bind-model="greetText"/>
            </p>`,
    selector: 'nested'
})
class ParagraphComponent {
    greetText = 'Hello, moto!'

    greet() {
        alert('Hello!')
    }

}

const mdl = new Module([Greeter, ParagraphComponent], document.getElementById('root'));