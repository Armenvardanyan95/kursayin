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

interface Changes {
    [key: string]: {previousValue: any, currentValue: any}
}

interface Target extends Object {
    onComponentChanges?: (changes: Changes) => void;
}

function proxify(object: Target, changeDetector: BehaviorSubject<Changes>) {
    function buildProxy(prefix: string, obj: Target) {
        return new Proxy(obj, {
            set: function(target: Target, propertyName: string, value: any) {
                // same as before, but add prefix
                console.log(`${prefix}${propertyName} has been changed from ${target[propertyName]} to ${value}`);
                if (target[propertyName] !== value) {
                    const changes: Changes = {[prefix + propertyName]: {previousValue: target[propertyName], currentValue: value}};
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

    return buildProxy('', object);
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

    private isComponent(node: VirtualDOM): boolean {
        return node.tagName.toLowerCase() in this.componentSelectorMapping;
    }

    private isTextNode(node: VirtualDOM): boolean {
        return node.tagName === '#text';
    }

    private isEventBinding(attrName: string): boolean {
        return attrName.startsWith('on-');
    }

    private isBinding(attrName: string): boolean {
        return attrName.startsWith('bind-');
    }

    private isModelBinding(attrName: string): boolean {
        return attrName == 'bind-model';
    }

    private renderTextNode(node: VirtualDOM, parent: HTMLElement): void {
        const text = document.createTextNode(node.content);
        parent.appendChild(text);
    }

    private renderComponent(node: VirtualDOM, parent: HTMLElement): void {
        const container = document.createElement(node.tagName);
        parent.appendChild(container);
        const componentClass = this.componentSelectorMapping[node.tagName.toLowerCase()];
        this.renderNodeList(componentClass.__virtualDom, container, componentClass);
    }

    private bindModel(node: VirtualDOM, element: HTMLInputElement, componentInstance, attrName: string) {
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

    private bindAttribute(node: VirtualDOM, element: HTMLElement, componentInstance, attrName: string) {
        const finalAttrName: string = attrName.slice(5, attrName.length);
        const bindingName = node.attributes[attrName];
        const attrValue = getPropValue(bindingName, componentInstance);
        element[finalAttrName] = attrValue;
        componentInstance.__changeDetector
            .filter(changes => changes && changes[bindingName])
            .subscribe(changes => element[finalAttrName] = changes[bindingName].currentValue);
    }

    private renderElement(node: VirtualDOM, componentInstance, parent: HTMLElement, componentClass): void {
        const element = document.createElement(node.tagName);
        for (const attrName in node.attributes) {
            if (this.isEventBinding(attrName)) {
                this.bindEvent(attrName, node, element, componentInstance);
            } else if (node.attributes.hasOwnProperty(attrName)) {
                if (this.isModelBinding(attrName)) {
                    this.bindModel(node, <HTMLInputElement>element, componentInstance, attrName);
                }
                if (this.isBinding(attrName)) {
                    this.bindAttribute(node, element, componentInstance, attrName);
                } else {
                    element[attrName + (attrName === 'class' ? 'Name' : '')] = node.attributes[attrName];
                }
            }
        }
        this.renderNodeList(node.children, element, componentClass);
        parent.appendChild(element);
    }

    private bindEvent(attrName: string, node: VirtualDOM, element: HTMLElement, componentInstance): void {
        const eventName: string = attrName.slice(3, attrName.length);
        const methodNameEndIndex = node.attributes[attrName].lastIndexOf('(');
        const methodName = node.attributes[attrName].slice(0, methodNameEndIndex);
        Rx.Observable.fromEvent(element, eventName).subscribe(event => componentInstance[methodName]())
    }

    private renderNodeList(nodeList: any, parent: HTMLElement, component: any) {
        const componentInstance = new component();
        for (const node of nodeList) {
            if (this.isComponent(node)) {
                this.renderComponent(node, parent);
            } else if (this.isTextNode(node)) {
                this.renderTextNode(node, parent);
            } else {
                this.renderElement(node, componentInstance, parent, component)
            }
        }
    }
}

@Component({
    template: `<div style="background-color: aqua">
                <button on-click="changeContent()">Click me!</button>
                    <span bind-innerText="hello"></span> <input type="text" bind-model="hello"/>
                    <nested></nested>
                    <nested></nested>
                    <nested></nested>
                    <nested></nested>
                    <nested></nested>
                <span bind-hidden="isButtonInVisible">I am togglable!</span>
            </div>`,
    selector: 'root'
})
class RootComponent {
    hello: string = 'Hello!';
    isButtonInVisible: boolean = false;

    changeContent(): void {
        this.isButtonInVisible = !this.isButtonInVisible;
    }
}

@Component({
    template: `<p>Paragpaph is nested!</p>`,
    selector: 'nested'
})
class NestedComponent {}

const module = new Module([RootComponent, NestedComponent], document.getElementById('root'));