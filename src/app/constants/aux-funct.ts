
/*AQUI VAMOS A METER FUNCIONES AUXILIARES*/ 

//Funciones simulando tiempo
export class timemgt{

    //funcion sleep
    static sleep (ms: number): Promise <void>{
        return new Promise (resolve => setTimeout(resolve, ms));
    } 
}